/**
 * requireApiKey middleware
 *
 * Authenticates requests via the `X-API-Key` header.
 * Sets req.apiKeyUser = { address, scope, keyId } on success.
 *
 * Scope enforcement happens here: a `read-only` key is rejected on any mutating
 * request (POST/PUT/PATCH/DELETE), so routes cannot forget to opt in. Routes that
 * are logically mutating but use a read verb can additionally chain requireReadWrite.
 *
 * Usage:
 *   router.get('/resource', requireApiKey, handler)                    // any scope
 *   router.post('/resource', requireApiKey, handler)                   // write scope enforced by method
 *   router.get('/dangerous', requireApiKey, requireReadWrite, handler) // explicit write scope
 */

import { Request, Response, NextFunction } from 'express'
import { findApiKeyByRawKey, touchApiKeyLastUsed, type ApiKeyScope } from '../db/apiKeyDb.js'
import { fail } from '../utils/apiResponse.js'

export interface ApiKeyUser {
    address: string
    scope: ApiKeyScope
    keyId: string
}

// Augment the Express Request type
declare global {
    namespace Express {
        interface Request {
            apiKeyUser?: ApiKeyUser
        }
    }
}

/** HTTP methods treated as mutating for scope purposes. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isMutatingMethod(method: string): boolean {
    return MUTATING_METHODS.has(method.toUpperCase())
}

/**
 * Middleware: requires a valid X-API-Key header.
 * Populates req.apiKeyUser on success and enforces the key's scope.
 */
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawKey = req.headers['x-api-key']

    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
        fail(res, 401, 'UNAUTHORIZED', 'Missing X-API-Key header')
        return
    }

    const row = await findApiKeyByRawKey(rawKey.trim()).catch(() => null)

    if (!row) {
        fail(res, 401, 'UNAUTHORIZED', 'Invalid or revoked API key')
        return
    }

    // A revoked key is still accepted while inside its rotation grace window.
    const inGracePeriod =
        !!row.grace_expires_at && row.grace_expires_at.getTime() > Date.now()

    if (row.revoked && !inGracePeriod) {
        fail(res, 401, 'UNAUTHORIZED', 'Invalid or revoked API key')
        return
    }

    req.apiKeyUser = { address: row.user_address, scope: row.scope, keyId: row.id }

    if (row.scope === 'read-only' && isMutatingMethod(req.method)) {
        fail(
            res,
            403,
            'FORBIDDEN',
            'This API key is read-only and cannot be used for write operations',
            { scope: row.scope, method: req.method },
        )
        return
    }

    // Fire-and-forget: update last_used_at
    void touchApiKeyLastUsed(row.id)

    next()
}

/**
 * Middleware: restricts access to read-write keys only.
 * Must be used AFTER requireApiKey.
 */
export function requireReadWrite(req: Request, res: Response, next: NextFunction): void {
    if (req.apiKeyUser?.scope !== 'read-write') {
        fail(res, 403, 'FORBIDDEN', 'This endpoint requires a read-write API key')
        return
    }
    next()
}
