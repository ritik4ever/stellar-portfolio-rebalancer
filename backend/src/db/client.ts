import pg from 'pg'
import { logger } from '../utils/logger.js'
import { hasDatabaseSecretConfigured, refreshDatabaseSecret } from '../config/runtimeSecrets.js'

let pool: pg.Pool | null = null

function getPoolSize(): number {
    const raw = process.env.DB_POOL_SIZE?.trim()
    if (raw) {
        const parsed = Number.parseInt(raw, 10)
        if (Number.isFinite(parsed) && parsed >= 1) return parsed
    }
    return 10
}

function poolConfigFromEnv(): pg.PoolConfig {
    const host = process.env.PGHOST?.trim()
    const database = process.env.PGDATABASE?.trim()
    const user = process.env.PGUSER?.trim()
    const poolSize = getPoolSize()
    if (host && database && user) {
        const port = Number.parseInt(process.env.PGPORT || '5432', 10)
        if (process.env.CI === 'true') {
            console.log('[DB] Pool config: explicit PG* user=%s host=%s port=%s database=%s', user, host, port, database)
        }
        return {
            user,
            password: process.env.PGPASSWORD ?? '',
            host,
            port: Number.isFinite(port) ? port : 5432,
            database,
            max: poolSize,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        }
    }

    const url = process.env.DATABASE_URL?.trim()
    if (url) {
        return {
            connectionString: url,
            max: poolSize,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        }
    }

    if (hasDatabaseSecretConfigured()) {
        throw new Error('Database secret configured but not loaded yet: call refreshDatabaseSecret() before getPool()')
    }

    throw new Error('Database not configured: set DATABASE_URL or PGHOST, PGDATABASE, and PGUSER')
}

export function getPool(): pg.Pool {
    if (!pool) {
        const config = poolConfigFromEnv()
        pool = new pg.Pool(config)

        pool.on('error', (err: Error) => {
            logger.error('[DB-POOL] Unexpected pool error', { error: String(err) })
        })

        logger.info('[DB-POOL] Initialized', { max: config.max })
    }
    return pool
}

function isPoolTimeout(err: unknown): boolean {
    return err instanceof Error && err.message.includes('timeout')
}

function isCredentialError(err: unknown): boolean {
    const candidate = err as { code?: unknown; message?: unknown }
    const code = typeof candidate.code === 'string' ? candidate.code : ''
    const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''

    return code === '28P01' ||
        code === '28000' ||
        message.includes('password authentication failed') ||
        message.includes('authentication failed') ||
        message.includes('scram') ||
        message.includes('sasl')
}

function handlePoolTimeout(err: unknown): never {
    logger.error('[DB-POOL] Connection pool exhausted — all connections busy', {
        error: String(err),
        poolSize: getPoolSize(),
    })
    const poolError = new PoolExhaustedError('Database connection pool exhausted — try again later')
    poolError.cause = err
    throw poolError
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
    await refreshDatabaseSecret()

    try {
        return await (getPool().query(text, params) as Promise<pg.QueryResult<T>>)
    } catch (err: unknown) {
        if (isPoolTimeout(err)) handlePoolTimeout(err)

        if (hasDatabaseSecretConfigured() && isCredentialError(err)) {
            logger.warn('[DB-POOL] Database credential error detected; refreshing Secrets Manager credential and retrying once', {
                error: err instanceof Error ? err.message : String(err),
            })
            await closePool()
            await refreshDatabaseSecret({ force: true })
            try {
                return await (getPool().query(text, params) as Promise<pg.QueryResult<T>>)
            } catch (retryErr: unknown) {
                if (isPoolTimeout(retryErr)) handlePoolTimeout(retryErr)
                throw retryErr
            }
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
    if (hasDatabaseSecretConfigured()) return true
    const host = process.env.PGHOST?.trim()
    const database = process.env.PGDATABASE?.trim()
    const user = process.env.PGUSER?.trim()
    if (host && database && user) return true
    return Boolean(process.env.DATABASE_URL?.trim())
}
