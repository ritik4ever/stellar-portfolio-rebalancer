import { describe, it, expect } from 'vitest'
import type { Response } from 'express'
import { ok, fail } from '../utils/apiResponse.js'

const mockRes = () => {
    const state: { status?: number; body?: unknown } = {}
    const res = {
        status(code: number) {
            state.status = code
            return this
        },
        json(payload: unknown) {
            state.body = payload
            return this
        }
    } as unknown as Response

    return { res, state }
}

describe('apiResponse helpers', () => {
    it('ok returns success envelope and default 200', () => {
        const { res, state } = mockRes()
        ok(res, { id: 'p1' })

        expect(state.status).toBe(200)
        expect((state.body as any).success).toBe(true)
        expect((state.body as any).data).toEqual({ id: 'p1' })
        expect((state.body as any).error).toBeNull()
        expect(typeof (state.body as any).timestamp).toBe('string')
    })

    it('ok supports custom status and meta', () => {
        const { res, state } = mockRes()
        ok(res, { created: true }, { status: 201, meta: { source: 'test' } })

        expect(state.status).toBe(201)
        expect((state.body as any).meta).toEqual({ source: 'test' })
    })

    it('fail returns standardized error envelope', () => {
        const { res, state } = mockRes()
        fail(res, 409, 'CONFLICT', 'Conflict occurred', { key: 'abc' })

        expect(state.status).toBe(409)
        expect((state.body as any).success).toBe(false)
        expect((state.body as any).data).toBeNull()
        expect((state.body as any).error).toEqual({
            code: 'CONFLICT',
            message: 'Conflict occurred',
            details: { key: 'abc' }
        })
    })
})

describe('fail() error serialization', () => {
    it('redacts credential values in the message but keeps the wording', () => {
        const { res, state } = mockRes()
        fail(res, 500, 'INTERNAL_ERROR', "Failed to get asset 'XLM': connection failed password=hunter2secret")

        const error = (state.body as any).error
        expect(error.message).toContain("Failed to get asset 'XLM'")
        expect(error.message).toContain('connection failed')
        expect(error.message).toContain('password=[REDACTED]')
        expect(error.message).not.toContain('hunter2secret')
    })

    it('keeps authored operator hints untouched', () => {
        const { res, state } = mockRes()
        fail(res, 503, 'SERVICE_UNAVAILABLE', 'ALLOW_FALLBACK_PRICES is disabled')

        expect((state.body as any).error.message).toBe('ALLOW_FALLBACK_PRICES is disabled')
    })

    it('drops the details payload of a server error', () => {
        const { res, state } = mockRes()
        fail(res, 500, 'INTERNAL_ERROR', 'Boom', { upstream: 'postgres://user:pw@db/app' })

        expect((state.body as any).error.details).toBeUndefined()
        expect(JSON.stringify(state.body)).not.toContain('postgres://')
    })

    it('keeps and sanitizes the details payload of a client error', () => {
        const { res, state } = mockRes()
        fail(res, 400, 'VALIDATION_ERROR', 'Invalid payload', { field: 'api_key', token: 'abc123' })

        expect((state.body as any).error.details).toEqual({ field: 'api_key', token: '[REDACTED]' })
    })

    it('reduces an Error instance in details to name and message', () => {
        const { res, state } = mockRes()
        const cause = new Error('upstream failed password=hunter2secret')
        fail(res, 422, 'UNPROCESSABLE', 'Invalid state', { cause })

        const details = (state.body as any).error.details
        expect(details.cause.name).toBe('Error')
        expect(details.cause.message).toContain('password=[REDACTED]')
        expect(details.cause.message).not.toContain('hunter2secret')
        expect(details.cause.stack).toBeUndefined()
    })

    it('never serializes stack frames', () => {
        const { res, state } = mockRes()
        fail(res, 500, 'INTERNAL_ERROR', 'Boom\n    at Object.<anonymous> (/srv/app/src/routes.ts:12:5)')

        expect((state.body as any).error.message).toBe('Boom')
    })
})
