/**
 * apiKeys.routes.ts
 * Routes: POST /api-keys, GET /api-keys, DELETE /api-keys/:id, POST /api-keys/:id/rotate
 *
 * Authentication: JWT (requireJwt) — users manage their own API keys via the web UI.
 * The generated keys are then used by programmatic clients via X-API-Key header.
 */

import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { requireJwt } from '../middleware/requireJwt.js'
import { validateRequest } from '../middleware/validate.js'
import {
    createApiKey,
    generateApiKeyString,
    generateApiKeyId,
    listApiKeysForUser,
    revokeApiKey,
    rotateApiKey,
    type ApiKeyScope,
} from '../db/apiKeyDb.js'
import { ok, fail } from '../utils/apiResponse.js'
import { getErrorMessage } from '../utils/helpers.js'

const router = Router()

// ── validation schemas ─────────────────────────────────────────────────────────

const createApiKeySchema = z.object({
    name: z.string().min(1).max(128),
    scope: z.enum(['read-only', 'read-write']),
})

const rotateApiKeySchema = z.object({
    gracePeriodMs: z.number().int().min(0).max(3_600_000).optional(),
})

// ── POST /api/v1/api-keys ──────────────────────────────────────────────────────
/**
 * Create a new scoped API key.
 * Returns the raw key ONCE — it is never retrievable again.
 */
router.post('/', requireJwt, validateRequest(createApiKeySchema), async (req: Request, res: Response) => {
    try {
        const userAddress = req.user!.address
        const { name, scope } = req.body as { name: string; scope: ApiKeyScope }

        const id     = generateApiKeyId()
        const rawKey = generateApiKeyString()

        await createApiKey(id, userAddress, name, rawKey, scope)

        return ok(res, {
            id,
            name,
            scope,
            key: rawKey,        // returned ONCE — store it securely
            keyPrefix: rawKey.slice(0, 8) + '...',
            createdAt: new Date().toISOString(),
            message: 'Store this key securely — it will not be shown again.',
        }, { status: 201 })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ── GET /api/v1/api-keys ───────────────────────────────────────────────────────
/**
 * List active (non-revoked) API keys for the authenticated user.
 * Key hashes are never returned; only prefix + metadata.
 */
router.get('/', requireJwt, async (req: Request, res: Response) => {
    try {
        const userAddress = req.user!.address
        const keys = await listApiKeysForUser(userAddress)

        const masked = keys.map(k => ({
            id:           k.id,
            name:         k.name,
            keyPrefix:    k.key_prefix + '...',
            scope:        k.scope,
            createdAt:    k.created_at,
            lastUsedAt:   k.last_used_at,
        }))

        return ok(res, { keys: masked, count: masked.length })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ── DELETE /api/v1/api-keys/:id ────────────────────────────────────────────────
/**
 * Revoke an API key immediately.
 */
router.delete('/:id', requireJwt, async (req: Request, res: Response) => {
    try {
        const userAddress = req.user!.address
        const { id } = req.params

        if (!id || typeof id !== 'string') {
            return fail(res, 400, 'VALIDATION_ERROR', 'Key id is required')
        }

        const revoked = await revokeApiKey(id, userAddress)
        if (!revoked) {
            return fail(res, 404, 'NOT_FOUND', 'API key not found or already revoked')
        }

        return ok(res, { id, revoked: true })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ── POST /api/v1/api-keys/:id/rotate ──────────────────────────────────────────
/**
 * Rotate an API key without downtime.
 * Old key remains valid for `gracePeriodMs` (default 5 min) while clients migrate.
 * Returns the new raw key ONCE.
 */
router.post('/:id/rotate', requireJwt, validateRequest(rotateApiKeySchema), async (req: Request, res: Response) => {
    try {
        const userAddress    = req.user!.address
        const { id }         = req.params
        const gracePeriodMs: number = req.body?.gracePeriodMs ?? 5 * 60 * 1000

        if (!id || typeof id !== 'string') {
            return fail(res, 400, 'VALIDATION_ERROR', 'Key id is required')
        }

        const newId     = generateApiKeyId()
        const newRawKey = generateApiKeyString()

        const result = await rotateApiKey(id, userAddress, newId, newRawKey, gracePeriodMs)
        if (!result) {
            return fail(res, 404, 'NOT_FOUND', 'API key not found or already revoked')
        }

        return ok(res, {
            newKeyId:      newId,
            name:          result.name,
            scope:         result.scope,
            key:           newRawKey,       // returned ONCE
            keyPrefix:     newRawKey.slice(0, 8) + '...',
            oldKeyId:      id,
            graceExpiresIn: `${gracePeriodMs / 1000}s`,
            message:       `Old key (${id}) remains valid for ${gracePeriodMs / 1000}s. Store this new key securely.`,
        }, { status: 201 })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

export const apiKeysRouter = router
