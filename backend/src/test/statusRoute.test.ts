import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

interface ProbeState {
    calls: number
    result: unknown
    error?: unknown
}

const oracleState: ProbeState = { calls: 0, result: undefined }
const dexState: ProbeState = { calls: 0, result: undefined }

function resetProbeState(): void {
    oracleState.calls = 0
    oracleState.result = { reachable: true, reason: 'ok', asset: 'XLM', latencyMs: 9 }
    oracleState.error = undefined
    dexState.calls = 0
    dexState.result = {
        reachable: true,
        reason: 'ok',
        fromAsset: 'XLM',
        toAsset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        latencyMs: 14,
        pathCount: 2,
    }
    dexState.error = undefined
}

/**
 * A fresh module graph per test (so the report cache starts empty) with the two
 * upstream services swapped for scripted fakes, so the suite never touches
 * Horizon or the Reflector oracle.
 */
async function createApp(): Promise<Express> {
    vi.resetModules()
    vi.doMock('../services/reflector.js', () => ({
        ReflectorService: class {
            async testOracleReachability(): Promise<unknown> {
                oracleState.calls += 1
                if (oracleState.error) throw oracleState.error
                return oracleState.result
            }
        },
    }))
    vi.doMock('../services/dex.js', () => ({
        StellarDEXService: class {
            async probeDexConnectivity(): Promise<unknown> {
                dexState.calls += 1
                if (dexState.error) throw dexState.error
                return dexState.result
            }
        },
    }))

    // Import express through the same freshly reset registry as the router so the
    // app and its router come from one module instance.
    const express = (await import('express')).default
    const { statusRouter } = await import('../api/status.routes.js')

    const app = express()
    app.use(express.json())
    app.use('/api', statusRouter)
    return app
}

beforeEach(() => {
    resetProbeState()
})

afterEach(() => {
    delete process.env.PUBLIC_STATUS_CACHE_TTL_MS
    vi.doUnmock('../services/reflector.js')
    vi.doUnmock('../services/dex.js')
})

describe('GET /api/status', () => {
    it('serves a live report to anonymous callers', async () => {
        const app = await createApp()

        const res = await request(app).get('/api/status')

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.status).toBe('healthy')
        expect(res.body.data.checks.reflector_oracle.status).toBe('ok')
        expect(res.body.data.checks.stellar_dex.status).toBe('ok')
        expect(oracleState.calls).toBe(1)
        expect(dexState.calls).toBe(1)
    })

    it('reports a degraded platform while still answering 200', async () => {
        oracleState.result = {
            reachable: false,
            reason: 'unreachable',
            asset: 'XLM',
            error: 'ECONNREFUSED',
        }
        const app = await createApp()

        const res = await request(app).get('/api/status')

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.status).toBe('degraded')
        expect(res.body.data.checks.reflector_oracle.reason).toBe('unreachable')
        expect(res.body.data.checks.stellar_dex.status).toBe('ok')
    })

    it('reports an unhealthy platform when the DEX cannot be queried', async () => {
        dexState.error = new Error('horizon unavailable')
        const app = await createApp()

        const res = await request(app).get('/api/status')

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.status).toBe('unhealthy')
        expect(res.body.data.checks.stellar_dex.status).toBe('down')
        expect(res.body.data.checks.stellar_dex.reason).toBe('error')
    })

    it('probes the upstreams once per cache window', async () => {
        process.env.PUBLIC_STATUS_CACHE_TTL_MS = '60000'
        const app = await createApp()

        const first = await request(app).get('/api/status')
        const second = await request(app).get('/api/status')

        expect(oracleState.calls).toBe(1)
        expect(dexState.calls).toBe(1)
        expect(first.body.data.cache.cached).toBe(false)
        expect(second.body.data.cache.cached).toBe(true)
    })
})
