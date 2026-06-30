import { createHash } from 'node:crypto'
import type { RequestHandler } from 'express'
import {
    dbGetIdempotencyResult,
    dbStoreIdempotencyResult
} from '../db/idempotencyDb.js'
import {
    redisGetIdempotencyResult,
    redisStoreIdempotencyResult
} from '../services/idempotencyRedisStore.js'
import { fail } from '../utils/apiResponse.js'
import { stableStringify } from '../utils/helpers.js'
import { logger } from '../utils/logger.js'

export const idempotencyMiddleware: RequestHandler = async (req, res, next) => {
    const key = req.headers['idempotency-key'] as string | undefined

    if (!key) return next()

    if (key.length < 1 || key.length > 255) {
        fail(res, 400, 'VALIDATION_ERROR', 'Idempotency-Key must be between 1 and 255 characters')
        return
    }

    const requestUser = req.user?.address
        ?? (req.headers['x-public-key'] as string | undefined)
        ?? 'anonymous'

    const requestHash = createHash('sha256')
        .update(req.method)
        .update(req.path)
        .update(stableStringify(req.body ?? {}))
        .update(requestUser)
        .digest('hex')

    const existingRedis = await redisGetIdempotencyResult(key)
    const existing = existingRedis ?? dbGetIdempotencyResult(key)

    if (existing) {
        if (existing.requestHash !== requestHash) {
            logger.warn('[IDEMPOTENCY] Key reuse with different payload', {
                key,
                method: req.method,
                path: req.path,
                user: requestUser,
                storedHash: existing.requestHash,
                newHash: requestHash,
            })
            fail(
                res,
                409,
                'CONFLICT',
                'Idempotency-Key already used with a different request payload',
                { idempotencyKey: key, reason: 'Payload hash mismatch' }
            )
            return
        }
        res.set('Idempotency-Replayed', 'true')
        res.set('Idempotency-Key', key)
        res.status(existing.statusCode).json(JSON.parse(existing.responseBody))
        return
    }

    const originalJson = res.json.bind(res)
    res.json = (body: unknown) => {
        try {
            dbStoreIdempotencyResult(
                key, requestHash, req.method, req.path, res.statusCode, body
            )
            redisStoreIdempotencyResult(
                key, requestHash, req.method, req.path, res.statusCode, body
            )
        } catch {
            // Never fail the actual request due to idempotency storage errors
        }
        res.set('Idempotency-Key', key)
        return originalJson(body)
    }

    next()
}
