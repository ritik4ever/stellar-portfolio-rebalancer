import pg from 'pg'
import { logger } from '../utils/logger.js'
import { credentialManager } from '../config/credentialManager.js'

let pool: pg.Pool | null = null

function getPoolSize(): number {
    const raw = process.env.DB_POOL_SIZE?.trim()
    if (raw) {
        const parsed = Number.parseInt(raw, 10)
        if (Number.isFinite(parsed) && parsed >= 1) return parsed
    }
    return 10
}

function poolConfigFromEnv(forceRefresh = false): pg.PoolConfig {
    const creds = credentialManager.getDbCredentialsSync(forceRefresh)
    const poolSize = getPoolSize()

    if (creds.host && creds.database && creds.user) {
        if (process.env.CI === 'true') {
            console.log('[DB] Pool config: explicit PG* user=%s host=%s port=%s database=%s', creds.user, creds.host, creds.port, creds.database)
        }
        return {
            user: creds.user,
            password: creds.password ?? '',
            host: creds.host,
            port: Number.isFinite(creds.port) && creds.port ? creds.port : 5432,
            database: creds.database,
            max: poolSize,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        }
    }

    if (creds.connectionString) {
        return {
            connectionString: creds.connectionString,
            max: poolSize,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        }
    }

    throw new Error('Database not configured: set DATABASE_URL or PGHOST, PGDATABASE, and PGUSER')
}

export function getPool(forceRefresh = false): pg.Pool {
    if (!pool || forceRefresh) {
        const config = poolConfigFromEnv(forceRefresh)
        pool = new pg.Pool(config)

        pool.on('error', (err: Error) => {
            if (isAuthOrConnectionError(err)) {
                logger.warn('[DB-POOL] Auth or connection error on idle pool client — triggering background pool refresh for secret rotation', { error: String(err) })
                refreshDbPool().catch((e) => {
                    logger.error('[DB-POOL] Background pool refresh failed', { error: String(e) })
                })
            } else {
                logger.error('[DB-POOL] Unexpected pool error', { error: String(err) })
            }
        })

        logger.info('[DB-POOL] Initialized', { max: config.max })
    }
    return pool
}

export async function refreshDbPool(): Promise<pg.Pool> {
    logger.info('[DB-POOL] Refreshing database credentials and resetting connection pool to tolerate rotation...')
    const oldPool = pool
    pool = null
    credentialManager.clearCache()
    await credentialManager.getDbCredentials(true)
    const newPool = getPool(true)
    if (oldPool) {
        oldPool.end().catch((err: unknown) => {
            logger.warn('[DB-POOL] Error while closing old connection pool during rotation refresh', { error: String(err) })
        })
    }
    return newPool
}

export function refreshDbPoolSync(): pg.Pool {
    logger.info('[DB-POOL] Synchronously refreshing database credentials and connection pool...')
    const oldPool = pool
    pool = null
    credentialManager.clearCache()
    const newPool = getPool(true)
    if (oldPool) {
        oldPool.end().catch((err: unknown) => {
            logger.warn('[DB-POOL] Error while closing old connection pool during rotation refresh', { error: String(err) })
        })
    }
    return newPool
}

export function resetDbPool(): void {
    if (pool) {
        const oldPool = pool
        pool = null
        oldPool.end().catch(() => {})
    }
    credentialManager.clearCache()
}

function isAuthOrConnectionError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false
    const anyErr = err as any
    const code = anyErr.code
    if (typeof code === 'string' && ['28P01', '28000', '57P01', '08006', '3D000'].includes(code)) {
        return true
    }
    const msg = (anyErr.message || '').toLowerCase()
    if (
        msg.includes('password authentication failed') ||
        msg.includes('authentication failed') ||
        msg.includes('invalid password') ||
        msg.includes('sasl authentication failed') ||
        msg.includes('no password supplied')
    ) {
        return true
    }
    return false
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
    try {
        return await (getPool().query(text, params) as Promise<pg.QueryResult<T>>)
    } catch (err: unknown) {
        if (isAuthOrConnectionError(err)) {
            logger.warn('[DB-POOL] Password authentication or connection failed — possible secret rotation event detected. Refreshing credentials and DB pool...', {
                error: String(err)
            })
            await refreshDbPool()
            return await (getPool().query(text, params) as Promise<pg.QueryResult<T>>)
        }
        if (err instanceof Error && err.message.includes('timeout')) {
            logger.error('[DB-POOL] Connection pool exhausted — all connections busy', {
                error: String(err),
                poolSize: getPoolSize(),
            })
            const poolError = new PoolExhaustedError('Database connection pool exhausted — try again later')
            poolError.cause = err
            throw poolError
        }
        throw err
    }
}

export class PoolExhaustedError extends Error {
    public readonly statusCode = 503
    constructor(message: string) {
        super(message)
        this.name = 'PoolExhaustedError'
    }
}

export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end()
        pool = null
    }
}

export function isDbConfigured(): boolean {
    return credentialManager.isDbConfigured()
}
