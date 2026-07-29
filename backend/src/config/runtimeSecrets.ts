import { fetchJsonSecret, maskSecretId, stableFingerprint } from './secretsManager.js'
import { logger } from '../utils/logger.js'

const DEFAULT_SECRET_REFRESH_MS = 5 * 60 * 1000
const MIN_SECRET_REFRESH_MS = 30 * 1000

export interface SecretRefreshResult {
    configured: boolean
    refreshed: boolean
    changed: boolean
    fingerprint?: string
}

export interface RuntimeSecretRefreshOptions {
    onDatabaseCredentialsChanged?: () => Promise<void> | void
    onRedisCredentialsChanged?: () => Promise<void> | void
}

let databaseFingerprint: string | null = null
let databaseLastRefreshAt = 0
let redisFingerprint: string | null = null
let redisLastRefreshAt = 0
let databaseRefreshTimer: NodeJS.Timeout | null = null
let redisRefreshTimer: NodeJS.Timeout | null = null

function envSecretId(...names: string[]): string | undefined {
    for (const name of names) {
        const value = process.env[name]?.trim()
        if (value) return value
    }
    return undefined
}

function refreshIntervalMs(envName: string): number {
    const raw = process.env[envName]?.trim()
    const parsed = raw ? Number.parseInt(raw, 10) : NaN
    if (Number.isFinite(parsed) && parsed >= MIN_SECRET_REFRESH_MS) return parsed
    return DEFAULT_SECRET_REFRESH_MS
}

function asString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return undefined
}

function asBoolean(value: unknown, defaultValue = false): boolean {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (['true', '1', 'yes', 'y'].includes(normalized)) return true
        if (['false', '0', 'no', 'n'].includes(normalized)) return false
    }
    return defaultValue
}

function setEnvIfDefined(name: string, value: string | undefined): void {
    if (value !== undefined) process.env[name] = value
}

function redactUrl(url: string): string {
    return url.replace(/:\/\/[^@]*@/, '://***@')
}

function endpointHost(value: string): string {
    const trimmed = value.trim()
    if (!trimmed.includes('://')) return trimmed.split(':')[0]

    try {
        return new URL(trimmed).hostname
    } catch {
        return trimmed.split(':')[0]
    }
}

function endpointPort(value: string, defaultPort: string): string {
    const trimmed = value.trim()
    if (!trimmed.includes('://')) {
        const parts = trimmed.split(':')
        return parts.length > 1 && parts[1] ? parts[1] : defaultPort
    }

    try {
        return new URL(trimmed).port || defaultPort
    } catch {
        return defaultPort
    }
}

function buildRedisUrl(secret: Record<string, unknown>): string | undefined {
    const explicitUrl = asString(secret.url) || asString(secret.redis_url) || asString(secret.REDIS_URL)
    if (explicitUrl) return explicitUrl

    const hostSource =
        asString(secret.primary_endpoint_address) ||
        asString(secret.host) ||
        asString(secret.hostname) ||
        asString(secret.endpoint) ||
        asString(secret.address)
    if (!hostSource) return undefined

    const port = asString(secret.port) || endpointPort(hostSource, '6379')
    const host = endpointHost(hostSource)
    const authToken =
        asString(secret.auth_token) ||
        asString(secret.password) ||
        asString(secret.token) ||
        asString(secret.REDIS_AUTH_TOKEN)
    const tls = asBoolean(secret.tls, asBoolean(secret.transit_encryption_enabled, true))
    const protocol = tls ? 'rediss' : 'redis'
    const auth = authToken ? `:${encodeURIComponent(authToken)}@` : ''

    return `${protocol}://${auth}${host}:${port}`
}

export function hasDatabaseSecretConfigured(): boolean {
    return Boolean(envSecretId('DB_SECRET_ARN', 'DATABASE_SECRET_ARN', 'PG_SECRET_ARN'))
}

export function hasRedisSecretConfigured(): boolean {
    return Boolean(envSecretId('REDIS_SECRET_ARN', 'REDIS_AUTH_SECRET_ARN'))
}

export async function refreshDatabaseSecret(options: { force?: boolean } = {}): Promise<SecretRefreshResult> {
    const secretId = envSecretId('DB_SECRET_ARN', 'DATABASE_SECRET_ARN', 'PG_SECRET_ARN')
    if (!secretId) return { configured: false, refreshed: false, changed: false }

    const now = Date.now()
    if (!options.force && databaseLastRefreshAt > 0 && now - databaseLastRefreshAt < refreshIntervalMs('DB_SECRET_CACHE_TTL_MS')) {
        return { configured: true, refreshed: false, changed: false, fingerprint: databaseFingerprint ?? undefined }
    }

    const secret = await fetchJsonSecret(secretId)
    const databaseUrl = asString(secret.url) || asString(secret.DATABASE_URL) || asString(secret.connectionString)
    const username = asString(secret.username) || asString(secret.user) || asString(secret.PGUSER)
    const password = asString(secret.password) || asString(secret.PGPASSWORD)
    const host = asString(secret.host) || asString(secret.hostname) || asString(secret.endpoint) || asString(secret.address)
    const port = asString(secret.port) || '5432'
    const database =
        asString(secret.dbname) ||
        asString(secret.database) ||
        asString(secret.db_name) ||
        asString(secret.PGDATABASE)

    setEnvIfDefined('DATABASE_URL', databaseUrl)
    setEnvIfDefined('PGUSER', username)
    setEnvIfDefined('PGPASSWORD', password)
    setEnvIfDefined('PGHOST', host)
    setEnvIfDefined('PGPORT', port)
    setEnvIfDefined('PGDATABASE', database)

    // Keep the legacy DB_* names synchronized for containers or scripts that still inspect them.
    setEnvIfDefined('DB_USER', username)
    setEnvIfDefined('DB_PASSWORD', password)
    setEnvIfDefined('DB_HOST', host)
    setEnvIfDefined('DB_NAME', database)

    const applied = {
        databaseUrl: databaseUrl ?? null,
        username: username ?? null,
        password: password ?? null,
        host: host ?? null,
        port,
        database: database ?? process.env.PGDATABASE ?? null,
    }
    const fingerprint = stableFingerprint(applied)
    const changed = databaseFingerprint !== null && databaseFingerprint !== fingerprint
    databaseFingerprint = fingerprint
    databaseLastRefreshAt = now

    logger.info('[SECRETS] Refreshed database credentials from Secrets Manager', {
        secretId: maskSecretId(secretId),
        changed,
        hostConfigured: Boolean(host),
        databaseConfigured: Boolean(database || process.env.PGDATABASE),
    })

    return { configured: true, refreshed: true, changed, fingerprint }
}

export async function refreshRedisSecret(options: { force?: boolean } = {}): Promise<SecretRefreshResult> {
    const secretId = envSecretId('REDIS_SECRET_ARN', 'REDIS_AUTH_SECRET_ARN')
    if (!secretId) return { configured: false, refreshed: false, changed: false }

    const now = Date.now()
    if (!options.force && redisLastRefreshAt > 0 && now - redisLastRefreshAt < refreshIntervalMs('REDIS_SECRET_CACHE_TTL_MS')) {
        return { configured: true, refreshed: false, changed: false, fingerprint: redisFingerprint ?? undefined }
    }

    const secret = await fetchJsonSecret(secretId)
    const redisUrl = buildRedisUrl(secret)
    const authToken =
        asString(secret.auth_token) ||
        asString(secret.password) ||
        asString(secret.token) ||
        asString(secret.REDIS_AUTH_TOKEN)

    setEnvIfDefined('REDIS_URL', redisUrl)
    setEnvIfDefined('REDIS_AUTH_TOKEN', authToken)

    const fingerprint = stableFingerprint({ redisUrl: redisUrl ?? null, authToken: authToken ?? null })
    const changed = redisFingerprint !== null && redisFingerprint !== fingerprint
    redisFingerprint = fingerprint
    redisLastRefreshAt = now

    logger.info('[SECRETS] Refreshed Redis credentials from Secrets Manager', {
        secretId: maskSecretId(secretId),
        changed,
        redisUrl: redisUrl ? redactUrl(redisUrl) : '<not-configured>',
    })

    return { configured: true, refreshed: true, changed, fingerprint }
}

export async function initializeRuntimeSecrets(): Promise<void> {
    await Promise.all([
        refreshDatabaseSecret({ force: true }).catch((error: unknown) => {
            logger.error('[SECRETS] Failed to load database credentials from Secrets Manager', {
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }),
        refreshRedisSecret({ force: true }).catch((error: unknown) => {
            logger.error('[SECRETS] Failed to load Redis credentials from Secrets Manager', {
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }),
    ])
}

export function startRuntimeSecretRefresh(options: RuntimeSecretRefreshOptions = {}): void {
    stopRuntimeSecretRefresh()

    if (hasDatabaseSecretConfigured()) {
        databaseRefreshTimer = setInterval(() => {
            void refreshDatabaseSecret({ force: true })
                .then(async (result) => {
                    if (result.changed) await options.onDatabaseCredentialsChanged?.()
                })
                .catch((error: unknown) => {
                    logger.error('[SECRETS] Database credential refresh failed', {
                        error: error instanceof Error ? error.message : String(error),
                    })
                })
        }, refreshIntervalMs('DB_SECRET_CACHE_TTL_MS'))
        databaseRefreshTimer.unref?.()
    }

    if (hasRedisSecretConfigured()) {
        redisRefreshTimer = setInterval(() => {
            void refreshRedisSecret({ force: true })
                .then(async (result) => {
                    if (result.changed) await options.onRedisCredentialsChanged?.()
                })
                .catch((error: unknown) => {
                    logger.error('[SECRETS] Redis credential refresh failed', {
                        error: error instanceof Error ? error.message : String(error),
                    })
                })
        }, refreshIntervalMs('REDIS_SECRET_CACHE_TTL_MS'))
        redisRefreshTimer.unref?.()
    }
}

export function stopRuntimeSecretRefresh(): void {
    if (databaseRefreshTimer) clearInterval(databaseRefreshTimer)
    if (redisRefreshTimer) clearInterval(redisRefreshTimer)
    databaseRefreshTimer = null
    redisRefreshTimer = null
}

export function __resetRuntimeSecretStateForTests(): void {
    stopRuntimeSecretRefresh()
    databaseFingerprint = null
    databaseLastRefreshAt = 0
    redisFingerprint = null
    redisLastRefreshAt = 0
}
