import Database from 'better-sqlite3'

interface IdempotencyRow {
    key: string
    request_hash: string
    method: string
    path: string
    status_code: number
    response_body: string
    created_at: string
    expires_at: string
}

export interface IdempotencyRecord {
    key: string
    requestHash: string
    method: string
    path: string
    statusCode: number
    responseBody: string
    createdAt: string
    expiresAt: string
}

let idemDb: Database.Database | null = null

function getDb(): Database.Database {
    if (!idemDb) {
        const dbPath = process.env.DB_PATH || './data/portfolio.db'
        idemDb = new Database(dbPath)
    }
    return idemDb
}

function ensureIdempotencyTable(): void {
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
            key TEXT PRIMARY KEY,
            request_hash TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            status_code INTEGER NOT NULL,
            response_body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
    `)
}

// TTL defaults to 24 hours
export function dbStoreIdempotencyResult(
    key: string,
    requestHash: string,
    method: string,
    path: string,
    statusCode: number,
    responseBody: unknown,
    ttlMs = 24 * 60 * 60 * 1000
): void {
    ensureIdempotencyTable()
    const now = new Date()
    getDb().prepare(`
        INSERT OR IGNORE INTO idempotency_keys
            (key, request_hash, method, path, status_code, response_body, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        key,
        requestHash,
        method,
        path,
        statusCode,
        JSON.stringify(responseBody),
        now.toISOString(),
        new Date(now.getTime() + ttlMs).toISOString()
    )
}

export function dbGetIdempotencyResult(key: string): IdempotencyRecord | undefined {
    ensureIdempotencyTable()
    const row = getDb().prepare<[string], IdempotencyRow>(
        `SELECT * FROM idempotency_keys WHERE key = ? AND datetime(expires_at) > datetime('now')`
    ).get(key)
    if (!row) return undefined
    return {
        key: row.key,
        requestHash: row.request_hash,
        method: row.method,
        path: row.path,
        statusCode: row.status_code,
        responseBody: row.response_body,
        createdAt: row.created_at,
        expiresAt: row.expires_at
    }
}

// Returns number of deleted rows
export function dbCleanupExpiredIdempotencyKeys(): number {
    ensureIdempotencyTable()
    const result = getDb().prepare(
        `DELETE FROM idempotency_keys WHERE datetime(expires_at) <= datetime('now')`
    ).run()
    return result.changes
}
