import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

const failMock = vi.fn()

vi.mock('../utils/apiResponse.js', () => ({
    fail: failMock
}))

describe('validateRequest middleware', () => {
    it('passes and normalizes valid payload', async () => {
        const { validateRequest } = await import('../middleware/validate.js')
        const schema = z.object({ amount: z.number().int() })
        const middleware = validateRequest(schema)
        const req: any = { body: { amount: 4, extra: 'drop' }, originalUrl: '/api/test' }
        const next = vi.fn()

        middleware(req, {} as any, next)

        expect(next).toHaveBeenCalledOnce()
        expect(req.body).toEqual({ amount: 4 })
        expect(failMock).not.toHaveBeenCalled()
    })

    it('returns standardized validation error payload when invalid', async () => {
        failMock.mockReset()
        const { validateRequest } = await import('../middleware/validate.js')
        const schema = z.object({ amount: z.number().int() })
        const middleware = validateRequest(schema)
        const req: any = { body: { amount: 'x' }, originalUrl: '/api/test' }

        middleware(req, {} as any, vi.fn())

        expect(failMock).toHaveBeenCalled()
        expect(failMock.mock.calls[0][1]).toBe(400)
        expect(failMock.mock.calls[0][2]).toBe('VALIDATION_ERROR')
    })
})
