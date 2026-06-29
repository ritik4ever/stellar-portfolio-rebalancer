import pg from 'pg'
import { logger } from '../utils/logger.js'

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

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
    try {
        return await (getPool().query(text, params) as Promise<pg.QueryResult<T>>)
    } catch (err: unknown) {
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
    const host = process.env.PGHOST?.trim()
    const database = process.env.PGDATABASE?.trim()
    const user = process.env.PGUSER?.trim()
    if (host && database && user) return true
    return Boolean(process.env.DATABASE_URL?.trim())
}
