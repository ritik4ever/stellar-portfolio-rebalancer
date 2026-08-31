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
    family_id?: string | null
    generation?: number
}

interface InMemoryEntry {
    id: string
    user_address: string
    expires_at: Date
    metadata?: RefreshTokenMetadata | null
    family_id?: string | null
    generation?: number
}

const inMemoryStore = new Map<string, InMemoryEntry>()

/** Options describing where a token sits in its rotation chain. */
export interface RefreshTokenFamilyOptions {
    familyId?: string
    generation?: number
}

export async function createRefreshToken(
    id: string,
    userAddress: string,
    token: string,
    expiresAt: Date,
    metadata?: RefreshTokenMetadata | null,
    family: RefreshTokenFamilyOptions = {}
): Promise<void> {
    const hash = tokenHash(token)
    const familyId = family.familyId ?? null
    const generation = family.generation ?? 0

    if (isDbConfigured()) {
        await getPool().query(
            `INSERT INTO refresh_tokens (id, user_address, token_hash, expires_at, metadata, family_id, generation)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, userAddress, hash, expiresAt, metadata ? JSON.stringify(metadata) : null, familyId, generation]
        )
    } else {
        inMemoryStore.set(hash, {
            id,
            user_address: userAddress,
            expires_at: expiresAt,
            metadata,
            family_id: familyId,
            generation,
        })
    }
}

export async function findRefreshToken(token: string): Promise<RefreshTokenRow | null> {
    const hash = tokenHash(token)
    if (isDbConfigured()) {
        const result = await getPool().query<RefreshTokenRow>(
            `SELECT id, user_address, token_hash, expires_at, created_at, metadata, family_id, generation
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
        metadata: entry.metadata,
        family_id: entry.family_id ?? null,
        generation: entry.generation ?? 0
    }
}

export async function findRefreshTokenById(id: string): Promise<RefreshTokenRow | null> {
    if (isDbConfigured()) {
        const result = await getPool().query<RefreshTokenRow>(
            `SELECT id, user_address, token_hash, expires_at, created_at, metadata, family_id, generation
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
                metadata: entry.metadata,
                family_id: entry.family_id ?? null,
                generation: entry.generation ?? 0
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

// ── refresh-token families (#1406) ─────────────────────────────────────────────
//
// A family is one login session's chain of rotated refresh tokens. Each refresh
// retires the current token (recorded in the rotations index) and issues the next
// generation. A refresh attempt that hits the rotations index is a replay of an
// already-rotated token, which revokes the whole family.

export interface RefreshTokenFamilyRow {
    id: string
    user_address: string
    current_generation: number
    revoked: boolean
    revoked_reason: string | null
}

export interface RotatedTokenRow {
    token_hash: string
    family_id: string
    generation: number
    rotated_at: Date
}

const inMemoryFamilies = new Map<string, RefreshTokenFamilyRow>()
const inMemoryRotations = new Map<string, RotatedTokenRow & { expires_at: Date }>()

export function generateRefreshTokenFamilyId(): string {
    return randomBytes(16).toString('hex')
}

export async function createRefreshTokenFamily(id: string, userAddress: string): Promise<void> {
    if (isDbConfigured()) {
        await getPool().query(
            `INSERT INTO refresh_token_families (id, user_address, current_generation)
             VALUES ($1, $2, 0)
             ON CONFLICT (id) DO NOTHING`,
            [id, userAddress]
        )
        return
    }
    inMemoryFamilies.set(id, {
        id,
        user_address: userAddress,
        current_generation: 0,
        revoked: false,
        revoked_reason: null,
    })
}

export async function getRefreshTokenFamily(id: string): Promise<RefreshTokenFamilyRow | null> {
    if (isDbConfigured()) {
        const result = await getPool().query<RefreshTokenFamilyRow>(
            `SELECT id, user_address, current_generation, revoked, revoked_reason
             FROM refresh_token_families WHERE id = $1`,
            [id]
        )
        return result.rows[0] ?? null
    }
    return inMemoryFamilies.get(id) ?? null
}

export async function advanceRefreshTokenFamily(id: string, generation: number): Promise<void> {
    if (isDbConfigured()) {
        await getPool().query(
            `UPDATE refresh_token_families
             SET current_generation = $1, updated_at = NOW()
             WHERE id = $2`,
            [generation, id]
        )
        return
    }
    const family = inMemoryFamilies.get(id)
    if (family) family.current_generation = generation
}

/** Record a token as rotated out so a later replay of it is detectable. */
export async function recordRotatedRefreshToken(
    token: string,
    familyId: string,
    generation: number,
    expiresAt: Date
): Promise<void> {
    const hash = tokenHash(token)
    if (isDbConfigured()) {
        await getPool().query(
            `INSERT INTO refresh_token_rotations (token_hash, family_id, generation, expires_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (token_hash) DO NOTHING`,
            [hash, familyId, generation, expiresAt]
        )
        return
    }
    inMemoryRotations.set(hash, {
        token_hash: hash,
        family_id: familyId,
        generation,
        rotated_at: new Date(),
        expires_at: expiresAt,
    })
}

/** Look up a token in the rotated-out index — a hit means the token was replayed. */
export async function findRotatedRefreshToken(token: string): Promise<RotatedTokenRow | null> {
    const hash = tokenHash(token)
    if (isDbConfigured()) {
        const result = await getPool().query<RotatedTokenRow>(
            `SELECT token_hash, family_id, generation, rotated_at
             FROM refresh_token_rotations WHERE token_hash = $1`,
            [hash]
        )
        const row = result.rows[0]
        if (!row) return null
        return { ...row, rotated_at: new Date(row.rotated_at) }
    }
    const entry = inMemoryRotations.get(hash)
    if (!entry) return null
    const { expires_at: _expires, ...row } = entry
    return row
}

/**
 * Revoke an entire family: mark it revoked and delete every live token in it.
 * Returns the number of live tokens that were destroyed.
 */
export async function revokeRefreshTokenFamily(
    familyId: string,
    reason: string
): Promise<number> {
    if (isDbConfigured()) {
        await getPool().query(
            `UPDATE refresh_token_families
             SET revoked = TRUE, revoked_reason = $1, updated_at = NOW()
             WHERE id = $2`,
            [reason, familyId]
        )
        const result = await getPool().query(
            'DELETE FROM refresh_tokens WHERE family_id = $1',
            [familyId]
        )
        return result.rowCount ?? 0
    }

    const family = inMemoryFamilies.get(familyId)
    if (family) {
        family.revoked = true
        family.revoked_reason = reason
    }

    let deleted = 0
    for (const [hash, entry] of inMemoryStore) {
        if (entry.family_id === familyId) {
            inMemoryStore.delete(hash)
            deleted++
        }
    }
    return deleted
}

/** Drop rotation records whose underlying token has expired anyway. */
export async function pruneExpiredRotations(now: Date = new Date()): Promise<number> {
    if (isDbConfigured()) {
        const result = await getPool().query(
            'DELETE FROM refresh_token_rotations WHERE expires_at <= $1',
            [now]
        )
        return result.rowCount ?? 0
    }
    let pruned = 0
    for (const [hash, entry] of inMemoryRotations) {
        if (entry.expires_at <= now) {
            inMemoryRotations.delete(hash)
            pruned++
        }
    }
    return pruned
}

/** Test seam: clear the in-memory family/rotation stores. */
export function resetRefreshTokenFamilyStoreForTests(): void {
    inMemoryFamilies.clear()
    inMemoryRotations.clear()
    inMemoryStore.clear()
}
