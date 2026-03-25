import pg from 'pg'

let pool: pg.Pool | null = null

/**
 * Prefer discrete PG* vars when present (e.g. GitHub Actions E2E). A bare or partial
 * DATABASE_URL can make node-pg/libpq fall back to the OS user (often "root" in CI),
 * which triggers: FATAL: role "root" does not exist.
 */
function poolConfigFromEnv(): pg.PoolConfig {
    const host = process.env.PGHOST?.trim()
    const database = process.env.PGDATABASE?.trim()
    const user = process.env.PGUSER?.trim()
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
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        }
    }

    const url = process.env.DATABASE_URL?.trim()
    if (url) {
        return {
            connectionString: url,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        }
    }

    throw new Error('Database not configured: set DATABASE_URL or PGHOST, PGDATABASE, and PGUSER')
}

export function getPool(): pg.Pool {
    if (!pool) {
        pool = new pg.Pool(poolConfigFromEnv())
    }
    return pool
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
    return getPool().query(text, params) as Promise<pg.QueryResult<T>>
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
