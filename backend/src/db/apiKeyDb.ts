/**
 * apiKeyDb.ts
 * Data-access layer for API key management.
 *
 * Keys are stored as scrypt hashes (node:crypto built-in).
 * The raw key is NEVER persisted; only a secure hash + display prefix are stored.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { getPool, isDbConfigured } from './client.js'

const scryptAsync = promisify(scrypt)

// ── constants ──────────────────────────────────────────────────────────────────
const SCRYPT_N = 16384   // CPU/memory cost factor
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN  = 64      // output hash length in bytes
const SALT_LEN = 16      // salt length in bytes

// ── types ──────────────────────────────────────────────────────────────────────

export type ApiKeyScope = 'read-only' | 'read-write'

export interface ApiKeyRow {
    id: string
    user_address: string
    name: string
    key_hash: string
    key_prefix: string
    scope: ApiKeyScope
    revoked: boolean
    grace_expires_at: Date | null
    created_at: Date
    last_used_at: Date | null
}

/** Minimal in-memory fallback for environments without DB (dev/test). */
const inMemoryStore = new Map<string, ApiKeyRow>()

// ── hashing helpers ────────────────────────────────────────────────────────────

/**
 * Hash a raw API key using scrypt.
 * Returns a string in the format:  scrypt$<saltHex>$<hashHex>
 */
export async function hashApiKey(rawKey: string): Promise<string> {
    const salt = randomBytes(SALT_LEN)
    const hash = await scryptAsync(rawKey, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }) as Buffer
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * Constant-time comparison of a raw key against a stored hash string.
 */
export async function verifyApiKey(rawKey: string, storedHash: string): Promise<boolean> {
    try {
        const parts = storedHash.split('$')
        if (parts.length !== 3 || parts[0] !== 'scrypt') return false
        const salt   = Buffer.from(parts[1], 'hex')
        const stored = Buffer.from(parts[2], 'hex')
        const derived = await scryptAsync(rawKey, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }) as Buffer
        // Pad if lengths differ to avoid timingSafeEqual throw (lengths must match)
        if (derived.length !== stored.length) return false
        return timingSafeEqual(derived, stored)
    } catch {
        return false
    }
}

/**
 * Generate a new API key string.
 * Format: spr_<48 random hex chars>  (spr = stellar-portfolio-rebalancer)
 */
export function generateApiKeyString(): string {
    return `spr_${randomBytes(24).toString('hex')}`
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function createApiKey(
    id: string,
    userAddress: string,
    name: string,
    rawKey: string,
    scope: ApiKeyScope
): Promise<void> {
    const keyHash   = await hashApiKey(rawKey)
    const keyPrefix = rawKey.slice(0, 8)

    const row: ApiKeyRow = {
        id,
        user_address: userAddress,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scope,
        revoked: false,
        grace_expires_at: null,
        created_at: new Date(),
        last_used_at: null,
    }

    if (isDbConfigured()) {
        await getPool().query(
            `INSERT INTO api_keys (id, user_address, name, key_hash, key_prefix, scope)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, userAddress, name, keyHash, keyPrefix, scope]
        )
    } else {
        inMemoryStore.set(keyHash, row)
    }
}

/**
 * Look up a key by its raw value — used during authentication.
 * Returns the row only if the key matches and is not revoked (or within grace period).
 */
export async function findApiKeyByRawKey(rawKey: string): Promise<ApiKeyRow | null> {
    if (isDbConfigured()) {
        // Fetch all non-revoked rows (or within grace) — we must hash-compare in code
        // because the hash is salted. We query by prefix to reduce candidates.
        const prefix = rawKey.slice(0, 8)
        const { rows } = await getPool().query<ApiKeyRow>(
            `SELECT * FROM api_keys
             WHERE key_prefix = $1
               AND (revoked = FALSE OR (revoked = FALSE AND grace_expires_at > NOW()))
             ORDER BY created_at DESC`,
            [prefix]
        )
        for (const row of rows) {
            if (await verifyApiKey(rawKey, row.key_hash)) {
                return normalizeRow(row)
            }
        }
        return null
    }

    // In-memory fallback
    for (const row of inMemoryStore.values()) {
        if (row.revoked) continue
        if (await verifyApiKey(rawKey, row.key_hash)) return row
    }
    return null
}

/** List active (non-revoked) keys for a user — returns masked data only. */
export async function listApiKeysForUser(userAddress: string): Promise<Omit<ApiKeyRow, 'key_hash'>[]> {
    if (isDbConfigured()) {
        const { rows } = await getPool().query<ApiKeyRow>(
            `SELECT id, user_address, name, key_prefix, scope, revoked, grace_expires_at, created_at, last_used_at
             FROM api_keys
             WHERE user_address = $1 AND revoked = FALSE
             ORDER BY created_at DESC`,
            [userAddress]
        )
        return rows.map(normalizeRow).map(({ key_hash: _omit, ...rest }) => rest)
    }

    return [...inMemoryStore.values()]
        .filter(r => r.user_address === userAddress && !r.revoked)
        .map(({ key_hash: _omit, ...rest }) => rest)
}

/** Revoke a key by id — only allows the owning user to revoke. */
export async function revokeApiKey(id: string, userAddress: string): Promise<boolean> {
    if (isDbConfigured()) {
        const result = await getPool().query(
            `UPDATE api_keys SET revoked = TRUE WHERE id = $1 AND user_address = $2 AND revoked = FALSE`,
            [id, userAddress]
        )
        return (result.rowCount ?? 0) > 0
    }

    for (const row of inMemoryStore.values()) {
        if (row.id === id && row.user_address === userAddress && !row.revoked) {
            row.revoked = true
            return true
        }
    }
    return false
}

/** Touch last_used_at — fire-and-forget, non-critical. */
export async function touchApiKeyLastUsed(id: string): Promise<void> {
    if (isDbConfigured()) {
        await getPool().query(
            `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
            [id]
        )
    } else {
        for (const row of inMemoryStore.values()) {
            if (row.id === id) { row.last_used_at = new Date(); break }
        }
    }
}

/**
 * Rotate: mark old key as revoked after a grace period (old key stays valid
 * until grace_expires_at to allow zero-downtime rotation), and return new key id.
 */
export async function rotateApiKey(
    oldKeyId: string,
    userAddress: string,
    newId: string,
    newRawKey: string,
    gracePeriodMs: number = 5 * 60 * 1000  // 5-minute grace by default
): Promise<{ name: string; scope: ApiKeyScope } | null> {
    if (isDbConfigured()) {
        const pool = getPool()

        // Fetch old key
        const { rows } = await pool.query<ApiKeyRow>(
            `SELECT * FROM api_keys WHERE id = $1 AND user_address = $2 AND revoked = FALSE`,
            [oldKeyId, userAddress]
        )
        if (rows.length === 0) return null
        const old = normalizeRow(rows[0])

        const graceExpires = new Date(Date.now() + gracePeriodMs)

        // Create the new key first
        await createApiKey(newId, userAddress, old.name, newRawKey, old.scope)

        // Mark old key revoked but with a grace expiry (auth middleware respects this)
        await pool.query(
            `UPDATE api_keys SET revoked = TRUE, grace_expires_at = $1 WHERE id = $2`,
            [graceExpires, oldKeyId]
        )

        return { name: old.name, scope: old.scope }
    }

    // In-memory fallback
    for (const row of inMemoryStore.values()) {
        if (row.id === oldKeyId && row.user_address === userAddress && !row.revoked) {
            await createApiKey(newId, userAddress, row.name, newRawKey, row.scope)
            row.revoked = true
            row.grace_expires_at = new Date(Date.now() + gracePeriodMs)
            return { name: row.name, scope: row.scope }
        }
    }
    return null
}

// ── helpers ────────────────────────────────────────────────────────────────────

function normalizeRow(row: ApiKeyRow): ApiKeyRow {
    return {
        ...row,
        created_at:      row.created_at      ? new Date(row.created_at)      : row.created_at,
        last_used_at:    row.last_used_at     ? new Date(row.last_used_at)    : null,
        grace_expires_at: row.grace_expires_at ? new Date(row.grace_expires_at) : null,
    }
}

export function generateApiKeyId(): string {
    return randomBytes(16).toString('hex')
}
