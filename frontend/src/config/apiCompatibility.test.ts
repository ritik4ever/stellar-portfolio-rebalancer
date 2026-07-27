import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkApiCompatibility } from './apiCompatibility'

describe('checkApiCompatibility', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('reports ok when the v1 envelope probe succeeds', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({
                    success: true,
                    data: { strategies: [] },
                    error: null,
                    timestamp: new Date().toISOString(),
                }),
            })),
        )

        const result = await checkApiCompatibility()
        expect(result.severity).toBe('ok')
    })

    it('flags non-json responses as an API target mismatch', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                json: async () => ({}),
            })),
        )

        const result = await checkApiCompatibility()
        expect(result.severity).toBe('error')
        expect(result.title).toMatch(/mismatch/i)
    })

    it('flags missing envelopes as incompatible', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ strategies: [] }),
            })),
        )

        const result = await checkApiCompatibility()
        expect(result.severity).toBe('error')
        expect(result.message).toMatch(/envelope/i)
    })
})
