/**
 * requireApiKey middleware
 *
 * Authenticates requests via the `X-API-Key` header.
 * Sets req.apiKeyUser = { address, scope } on success.
 *
 * Usage:
 *   router.get('/resource', requireApiKey, handler)                 // any scope
 *   router.post('/resource', requireApiKey, requireReadWrite, handler) // write scope
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

/**
 * Middleware: requires a valid X-API-Key header.
 * Populates req.apiKeyUser on success.
 */
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawKey = req.headers['x-api-key']

    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
        fail(res, 401, 'UNAUTHORIZED', 'Missing X-API-Key header')
        return
    }

    const row = await findApiKeyByRawKey(rawKey.trim()).catch(() => null)

    if (!row || row.revoked) {
        fail(res, 401, 'UNAUTHORIZED', 'Invalid or revoked API key')
        return
    }

    // Grace-period check: key is revoked but still within the grace window
    if (row.revoked && row.grace_expires_at && row.grace_expires_at > new Date()) {
        // Allow — key is in rotation grace period
    } else if (row.revoked) {
        fail(res, 401, 'UNAUTHORIZED', 'Invalid or revoked API key')
        return
    }

    req.apiKeyUser = { address: row.user_address, scope: row.scope, keyId: row.id }

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
