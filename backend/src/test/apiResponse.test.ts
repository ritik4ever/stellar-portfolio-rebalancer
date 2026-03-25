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
