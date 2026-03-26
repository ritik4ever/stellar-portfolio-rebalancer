import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/browserPriceService', () => ({
    browserPriceService: {
        getCurrentPrices: vi.fn(),
        testConnection: vi.fn()
    }
}))

describe('apiRequest envelope handling', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.restoreAllMocks()
    })

    it('returns envelope data for successful /api responses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
                success: true,
                data: { portfolioId: 'p1' },
                error: null,
                timestamp: new Date().toISOString()
            })
        })))

        const { apiRequest } = await import('./api')
        const result = await apiRequest<{ portfolioId: string }>('/api/portfolio/p1')

        expect(result).toEqual({ portfolioId: 'p1' })
    })

    it('throws ApiClientError for standardized API failures', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
                success: false,
                data: null,
                error: {
                    code: 'CONFLICT',
                    message: 'Already exists',
                    details: { id: 'p1' }
                },
                timestamp: new Date().toISOString()
            })
        })))

        const { apiRequest, ApiClientError } = await import('./api')

        await expect(apiRequest('/api/portfolio/p1')).rejects.toMatchObject<ApiClientError>({
            name: 'ApiClientError',
            status: 409,
            code: 'CONFLICT',
            message: 'Already exists',
            details: { id: 'p1' }
        })
    })

    it('returns plain text for non-json responses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => 'pong'
        })))

        const { apiRequest } = await import('./api')
        const result = await apiRequest<string>('/health')

        expect(result).toBe('pong')
    })
})
