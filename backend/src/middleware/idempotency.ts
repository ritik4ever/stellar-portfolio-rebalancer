import { createHash } from 'node:crypto'
import type { RequestHandler } from 'express'
import {
    dbGetIdempotencyResult,
    dbStoreIdempotencyResult
} from '../db/idempotencyDb.js'

export const idempotencyMiddleware: RequestHandler = (req, res, next) => {
    const key = req.headers['idempotency-key'] as string | undefined

    // No header → pass through (idempotency is opt-in)
    if (!key) return next()

    if (key.length < 1 || key.length > 255) {
        res.status(400).json({
            error: 'Idempotency-Key must be between 1 and 255 characters'
        })
        return
    }

    // Fingerprint = method + path + canonicalised body
    const requestHash = createHash('sha256')
        .update(req.method)
        .update(req.path)
        .update(JSON.stringify(req.body ?? {}))
        .digest('hex')

    const existing = dbGetIdempotencyResult(key)

    if (existing) {
        if (existing.requestHash !== requestHash) {
            // Same key, different payload → reject
            res.status(409).json({
                error: 'Idempotency-Key already used with a different request payload',
                idempotencyKey: key
            })
            return
        }
        // Same key, same payload → safe replay
        res.set('Idempotency-Replayed', 'true')
        res.set('Idempotency-Key', key)
        res.status(existing.statusCode).json(JSON.parse(existing.responseBody))
        return
    }

    // First time — intercept res.json to persist the result before sending
    const originalJson = res.json.bind(res)
    res.json = (body: unknown) => {
        try {
            dbStoreIdempotencyResult(
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
