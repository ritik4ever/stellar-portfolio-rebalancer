import { describe, it, expect, vi, beforeEach } from 'vitest'

const failMock = vi.fn()
const loggerErrorMock = vi.fn()

vi.mock('../utils/apiResponse.js', () => ({
    fail: failMock
}))

vi.mock('../utils/logger.js', () => ({
    logger: {
        error: loggerErrorMock
    }
}))

describe('apiErrorHandler', () => {
    beforeEach(() => {
        failMock.mockReset()
        loggerErrorMock.mockReset()
    })

    it('delegates to next when headers already sent', async () => {
        const { apiErrorHandler } = await import('../middleware/apiErrorHandler.js')
        const next = vi.fn()

        apiErrorHandler(new Error('boom'), {
            requestId: 'r1',
            method: 'GET',
            originalUrl: '/api/test'
        } as any, {
            headersSent: true
        } as any, next)

        expect(next).toHaveBeenCalledOnce()
        expect(failMock).not.toHaveBeenCalled()
    })

    it('returns mapped envelope for unknown errors', async () => {
        const { apiErrorHandler } = await import('../middleware/apiErrorHandler.js')
        const next = vi.fn()

        apiErrorHandler(new Error('db down'), {
            requestId: 'r2',
            method: 'POST',
            originalUrl: '/api/portfolio'
        } as any, {
            headersSent: false
        } as any, next)

        expect(loggerErrorMock).toHaveBeenCalled()
        expect(failMock).toHaveBeenCalledWith(
            expect.anything(),
            500,
            'INTERNAL_ERROR',
            'db down',
            undefined
        )
    })
})
