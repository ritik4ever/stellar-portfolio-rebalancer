import { describe, it, expect, vi } from 'vitest'

const failMock = vi.fn()

vi.mock('../utils/apiResponse.js', () => ({
    fail: failMock
}))

describe('blockDebugInProduction', () => {
    it('returns NOT_FOUND when debug routes are disabled', async () => {
        vi.resetModules()
        vi.doMock('../config/featureFlags.js', () => ({
            getFeatureFlags: () => ({ enableDebugRoutes: false })
        }))
        const { blockDebugInProduction } = await import('../middleware/debugGate.js')

        const next = vi.fn()
        blockDebugInProduction({} as any, {} as any, next)

        expect(next).not.toHaveBeenCalled()
        expect(failMock).toHaveBeenCalledWith(expect.anything(), 404, 'NOT_FOUND', 'Not Found')
    })

    it('calls next when debug routes are enabled', async () => {
        vi.resetModules()
        failMock.mockReset()
        vi.doMock('../config/featureFlags.js', () => ({
            getFeatureFlags: () => ({ enableDebugRoutes: true })
        }))
        const { blockDebugInProduction } = await import('../middleware/debugGate.js')

        const next = vi.fn()
        blockDebugInProduction({} as any, {} as any, next)

        expect(next).toHaveBeenCalledOnce()
        expect(failMock).not.toHaveBeenCalled()
    })
})
