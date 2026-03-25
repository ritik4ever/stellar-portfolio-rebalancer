import pg from 'pg'

let pool: pg.Pool | null = null

function connectionString(): string | undefined {
    return process.env.DATABASE_URL
}

export function getPool(): pg.Pool {
    if (!pool) {
        const url = connectionString()
        if (!url) {
            throw new Error('DATABASE_URL is not set')
        }
        pool = new pg.Pool({
            connectionString: url,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        })
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
    return Boolean(connectionString())
}
