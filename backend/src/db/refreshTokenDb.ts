import { randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'
import { getPool } from './client.js'
import { isDbConfigured } from './client.js'

const tokenHash = (token: string): string =>
    createHash('sha256').update(token).digest('hex')

export interface RefreshTokenRow {
    id: string
    user_address: string
    token_hash: string
    expires_at: Date
    created_at: Date
}

const inMemoryStore = new Map<string, { id: string; user_address: string; expires_at: Date }>()

export async function createRefreshToken(
    id: string,
    userAddress: string,
    token: string,
    expiresAt: Date
): Promise<void> {
    const hash = tokenHash(token)
    if (isDbConfigured()) {
        await getPool().query(
            `INSERT INTO refresh_tokens (id, user_address, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [id, userAddress, hash, expiresAt]
        )
    } else {
        inMemoryStore.set(hash, { id, user_address: userAddress, expires_at: expiresAt })
    }
}

export async function findRefreshToken(token: string): Promise<RefreshTokenRow | null> {
    const hash = tokenHash(token)
    if (isDbConfigured()) {
        const result = await getPool().query<RefreshTokenRow>(
            `SELECT id, user_address, token_hash, expires_at, created_at
             FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
            [hash]
        )
        const row = result.rows[0]
        return row ? { ...row, expires_at: new Date(row.expires_at), created_at: new Date(row.created_at) } : null
    }
    const entry = inMemoryStore.get(hash)
    if (!entry || entry.expires_at <= new Date()) return null
    return {
        id: entry.id,
        user_address: entry.user_address,
        token_hash: hash,
        expires_at: entry.expires_at,
        created_at: new Date()
    }
}

export async function deleteRefreshTokenById(id: string): Promise<boolean> {
    if (isDbConfigured()) {
        const result = await getPool().query('DELETE FROM refresh_tokens WHERE id = $1', [id])
        return (result.rowCount ?? 0) > 0
    }
    for (const [h, entry] of inMemoryStore) {
        if (entry.id === id) {
            inMemoryStore.delete(h)
            return true
        }
    }
    return false
}

export async function deleteRefreshTokenByHash(tokenHashValue: string): Promise<boolean> {
    if (isDbConfigured()) {
        const result = await getPool().query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHashValue])
        return (result.rowCount ?? 0) > 0
    }
    return inMemoryStore.delete(tokenHashValue)
}

export async function deleteAllRefreshTokensForUser(userAddress: string): Promise<number> {
    if (isDbConfigured()) {
        const result = await getPool().query('DELETE FROM refresh_tokens WHERE user_address = $1', [userAddress])
        return result.rowCount ?? 0
    }
    let count = 0
    for (const [h, entry] of inMemoryStore) {
        if (entry.user_address === userAddress) {
            inMemoryStore.delete(h)
            count++
        }
    }
    return count
}

export function generateRefreshTokenId(): string {
    return randomBytes(32).toString('hex')
}
