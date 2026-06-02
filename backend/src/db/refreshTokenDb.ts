import { randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'
import { getPool } from './client.js'
import { isDbConfigured } from './client.js'
import type { RefreshTokenMetadata } from '../types/index.js'

const tokenHash = (token: string): string =>
    createHash('sha256').update(token).digest('hex')

export interface RefreshTokenRow {
    id: string
    user_address: string
    token_hash: string
    expires_at: Date
    created_at: Date
    metadata?: RefreshTokenMetadata | null
}

interface InMemoryEntry {
    id: string
    user_address: string
    expires_at: Date
    metadata?: RefreshTokenMetadata | null
}

const inMemoryStore = new Map<string, InMemoryEntry>()

export async function createRefreshToken(
    id: string,
    userAddress: string,
    token: string,
    expiresAt: Date,
    metadata?: RefreshTokenMetadata | null
): Promise<void> {
    const hash = tokenHash(token)
    if (isDbConfigured()) {
        await getPool().query(
            `INSERT INTO refresh_tokens (id, user_address, token_hash, expires_at, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, userAddress, hash, expiresAt, metadata ? JSON.stringify(metadata) : null]
        )
    } else {
        inMemoryStore.set(hash, { id, user_address: userAddress, expires_at: expiresAt, metadata })
    }
}

export async function findRefreshToken(token: string): Promise<RefreshTokenRow | null> {
    const hash = tokenHash(token)
    if (isDbConfigured()) {
        const result = await getPool().query<RefreshTokenRow>(
            `SELECT id, user_address, token_hash, expires_at, created_at, metadata
             FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
            [hash]
        )
        const row = result.rows[0]
        if (!row) return null
        return {
            ...row,
            expires_at: new Date(row.expires_at),
            created_at: new Date(row.created_at),
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
        }
    }
    const entry = inMemoryStore.get(hash)
    if (!entry || entry.expires_at <= new Date()) return null
    return {
        id: entry.id,
        user_address: entry.user_address,
        token_hash: hash,
        expires_at: entry.expires_at,
        created_at: new Date(),
        metadata: entry.metadata
    }
}

export async function findRefreshTokenById(id: string): Promise<RefreshTokenRow | null> {
    if (isDbConfigured()) {
        const result = await getPool().query<RefreshTokenRow>(
            `SELECT id, user_address, token_hash, expires_at, created_at, metadata
             FROM refresh_tokens WHERE id = $1`,
            [id]
        )
        const row = result.rows[0]
        if (!row) return null
        return {
            ...row,
            expires_at: new Date(row.expires_at),
            created_at: new Date(row.created_at),
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
        }
    }
    for (const [hash, entry] of inMemoryStore) {
        if (entry.id === id) {
            return {
                id: entry.id,
                user_address: entry.user_address,
                token_hash: hash,
                expires_at: entry.expires_at,
                created_at: new Date(),
                metadata: entry.metadata
            }
        }
    }
    return null
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

export async function touchRefreshToken(id: string): Promise<void> {
    const now = new Date().toISOString()
    if (isDbConfigured()) {
        await getPool().query(
            `UPDATE refresh_tokens SET metadata = JSONB_SET(COALESCE(metadata, '{}'::jsonb), '{lastUsedAt}', to_jsonb($1::text)) WHERE id = $2`,
            [now, id]
        )
    } else {
        for (const entry of inMemoryStore.values()) {
            if (entry.id === id) {
                entry.metadata = { ...entry.metadata, lastUsedAt: now }
                break
            }
        }
    }
}

export function generateRefreshTokenId(): string {
    return randomBytes(32).toString('hex')
}
