import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The default probes reach out to Reflector and Horizon, so every test swaps the
 * two service modules for scripted fakes. `vi.resetModules()` before each import
 * gives each test its own copy of the module-level report cache.
 */

interface ProbeState {
    calls: number
    result: unknown
    error?: unknown
}

const oracleState: ProbeState = { calls: 0, result: undefined }
const dexState: ProbeState = { calls: 0, result: undefined }

const ORACLE_OK = {
    reachable: true,
    reason: 'ok',
    asset: 'XLM',
    endpoint: 'https://reflector.example',
    latencyMs: 12,
    quoteTimestamp: 1_700_000_000,
}

const DEX_OK = {
    reachable: true,
    reason: 'ok',
    fromAsset: 'XLM',
    toAsset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    latencyMs: 21,
    pathCount: 2,
    bestDestinationAmount: 0.9142,
}

function resetProbeState(): void {
    oracleState.calls = 0
    oracleState.result = ORACLE_OK
    oracleState.error = undefined
    dexState.calls = 0
    dexState.result = DEX_OK
    dexState.error = undefined
}

async function loadPublicStatus(): Promise<typeof import('../monitoring/publicStatus.js')> {
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
    return import('../monitoring/publicStatus.js')
}

beforeEach(() => {
    resetProbeState()
})

afterEach(() => {
    delete process.env.PUBLIC_STATUS_CACHE_TTL_MS
    vi.doUnmock('../services/reflector.js')
    vi.doUnmock('../services/dex.js')
})

describe('mapOracleReachability', () => {
    it('reports ok for a reachable oracle serving fresh quotes', async () => {
        const { mapOracleReachability } = await loadPublicStatus()

        const check = mapOracleReachability(ORACLE_OK as never, 99, '2026-01-01T00:00:00.000Z')

        expect(check.status).toBe('ok')
        expect(check.reason).toBe('ok')
        expect(check.latency_ms).toBe(12)
        expect(check.last_checked).toBe('2026-01-01T00:00:00.000Z')
        expect(check.details?.asset).toBe('XLM')
    })

    it('degrades instead of failing when the oracle is unreachable', async () => {
        const { mapOracleReachability } = await loadPublicStatus()

        const check = mapOracleReachability(
            { reachable: false, reason: 'unreachable', asset: 'XLM', error: 'ECONNREFUSED' } as never,
            40,
            '2026-01-01T00:00:00.000Z',
        )

        expect(check.status).toBe('degraded')
        expect(check.reason).toBe('unreachable')
        expect(check.latency_ms).toBe(40)
        expect(check.message).toContain('secondary source')
        expect(check.details?.error).toBe('ECONNREFUSED')
    })

    it('degrades when the oracle serves stale quotes', async () => {
        const { mapOracleReachability } = await loadPublicStatus()

        const check = mapOracleReachability(
            { reachable: true, reason: 'stale', asset: 'XLM', latencyMs: 8 } as never,
            8,
            '2026-01-01T00:00:00.000Z',
        )

        expect(check.status).toBe('degraded')
        expect(check.reason).toBe('stale')
    })
})

describe('mapDexConnectivity', () => {
    it('reports ok when Horizon quotes the probed pair', async () => {
        const { mapDexConnectivity } = await loadPublicStatus()

        const check = mapDexConnectivity(DEX_OK as never, 21, '2026-01-01T00:00:00.000Z')

        expect(check.status).toBe('ok')
        expect(check.details?.path_count).toBe(2)
        expect(check.details?.from_asset).toBe('XLM')
    })

    it('degrades when the DEX is reachable but has no route for the pair', async () => {
        const { mapDexConnectivity } = await loadPublicStatus()

        const check = mapDexConnectivity({ ...DEX_OK, reason: 'no_path', pathCount: 0 } as never, 15, '2026-01-01T00:00:00.000Z')

        expect(check.status).toBe('degraded')
        expect(check.reason).toBe('no_path')
    })

    it('reports down when the DEX probe times out', async () => {
        const { mapDexConnectivity } = await loadPublicStatus()

        const check = mapDexConnectivity(
            { ...DEX_OK, reachable: false, reason: 'timeout', pathCount: 0, error: 'timed out' } as never,
            5000,
            '2026-01-01T00:00:00.000Z',
        )

        expect(check.status).toBe('down')
        expect(check.reason).toBe('timeout')
    })

    it('reports down with the HTTP status when Horizon errors', async () => {
        const { mapDexConnectivity } = await loadPublicStatus()

        const check = mapDexConnectivity(
            { ...DEX_OK, reachable: false, reason: 'http_error', httpStatus: 503, pathCount: 0 } as never,
            60,
            '2026-01-01T00:00:00.000Z',
        )

        expect(check.status).toBe('down')
        expect(check.details?.http_status).toBe(503)
    })
})

describe('summarizePublicStatus', () => {
    it('is healthy only when every check is ok', async () => {
        const { summarizePublicStatus } = await loadPublicStatus()

        expect(summarizePublicStatus([
            { status: 'ok', last_checked: 't', latency_ms: 1, reason: 'ok', message: 'm' },
            { status: 'ok', last_checked: 't', latency_ms: 1, reason: 'ok', message: 'm' },
        ])).toBe('healthy')
    })

    it('is degraded when no check is down', async () => {
        const { summarizePublicStatus } = await loadPublicStatus()

        expect(summarizePublicStatus([
            { status: 'ok', last_checked: 't', latency_ms: 1, reason: 'ok', message: 'm' },
            { status: 'degraded', last_checked: 't', latency_ms: 1, reason: 'stale', message: 'm' },
        ])).toBe('degraded')
    })

    it('is unhealthy as soon as one check is down', async () => {
        const { summarizePublicStatus } = await loadPublicStatus()

        expect(summarizePublicStatus([
            { status: 'degraded', last_checked: 't', latency_ms: 1, reason: 'stale', message: 'm' },
            { status: 'down', last_checked: 't', latency_ms: 1, reason: 'timeout', message: 'm' },
        ])).toBe('unhealthy')
    })
})

describe('buildPublicStatus', () => {
    it('probes both upstreams and reports a healthy platform', async () => {
        const { buildPublicStatus } = await loadPublicStatus()

        const report = await buildPublicStatus()

        expect(oracleState.calls).toBe(1)
        expect(dexState.calls).toBe(1)
        expect(report.status).toBe('healthy')
        expect(report.checks.reflector_oracle.status).toBe('ok')
        expect(report.checks.stellar_dex.status).toBe('ok')
        expect(report.checks.stellar_dex.details?.best_destination_amount).toBe(0.9142)
        expect(report.cache.cached).toBe(false)
        expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false)
    })

    it('reports degraded when the DEX has no route for the probed pair', async () => {
        dexState.result = { ...DEX_OK, reason: 'no_path', pathCount: 0 }
        const { buildPublicStatus } = await loadPublicStatus()

        const report = await buildPublicStatus()

        expect(report.status).toBe('degraded')
        expect(report.checks.stellar_dex.status).toBe('degraded')
        expect(report.checks.reflector_oracle.status).toBe('ok')
    })

    it('reports unhealthy without rejecting when a probe throws', async () => {
        oracleState.error = new Error('socket hang up')
        const { buildPublicStatus } = await loadPublicStatus()

        const report = await buildPublicStatus()

        expect(report.status).toBe('unhealthy')
        expect(report.checks.reflector_oracle.status).toBe('down')
        expect(report.checks.reflector_oracle.reason).toBe('error')
        expect(report.checks.reflector_oracle.details?.error).toBe('socket hang up')
    })

    it('accepts injected probes so callers can reuse the report shape', async () => {
        const { buildPublicStatus } = await loadPublicStatus()

        const report = await buildPublicStatus({
            probeOracle: async (now) => ({
                status: 'ok',
                last_checked: new Date(now()).toISOString(),
                latency_ms: 3,
                reason: 'ok',
                message: 'stubbed oracle',
            }),
            probeDex: async (now) => ({
                status: 'down',
                last_checked: new Date(now()).toISOString(),
                latency_ms: 4,
                reason: 'api_unavailable',
                message: 'stubbed dex',
            }),
        })

        expect(oracleState.calls).toBe(0)
        expect(dexState.calls).toBe(0)
        expect(report.status).toBe('unhealthy')
        expect(report.checks.reflector_oracle.message).toBe('stubbed oracle')
    })
})

describe('getPublicStatus caching', () => {
    it('serves reports from cache inside the TTL', async () => {
        process.env.PUBLIC_STATUS_CACHE_TTL_MS = '60000'
        const { getPublicStatus } = await loadPublicStatus()

        const first = await getPublicStatus()
        const second = await getPublicStatus()

        expect(oracleState.calls).toBe(1)
        expect(dexState.calls).toBe(1)
        expect(first.cache.cached).toBe(false)
        expect(second.cache.cached).toBe(true)
        expect(second.cache.ttl_ms).toBe(60000)
        expect(second.cache.age_ms).toBeGreaterThanOrEqual(0)
        expect(second.status).toBe(first.status)
    })

    it('re-probes once the cached report is older than the TTL', async () => {
        process.env.PUBLIC_STATUS_CACHE_TTL_MS = '1000'
        const { getPublicStatus } = await loadPublicStatus()
        let clock = 1_000_000

        await getPublicStatus({ now: () => clock })
        clock += 5_000
        await getPublicStatus({ now: () => clock })

        expect(oracleState.calls).toBe(2)
        expect(dexState.calls).toBe(2)
    })

    it('shares a single in-flight probe between concurrent callers', async () => {
        process.env.PUBLIC_STATUS_CACHE_TTL_MS = '60000'
        const { getPublicStatus } = await loadPublicStatus()

        const [first, second] = await Promise.all([getPublicStatus(), getPublicStatus()])

        expect(oracleState.calls).toBe(1)
        expect(dexState.calls).toBe(1)
        expect(first.status).toBe('healthy')
        expect(second.status).toBe('healthy')
    })

    it('bypasses the cache when probes are injected', async () => {
        process.env.PUBLIC_STATUS_CACHE_TTL_MS = '60000'
        const { getPublicStatus } = await loadPublicStatus()
        const probeOracle = async () => ({
            status: 'ok' as const,
            last_checked: new Date().toISOString(),
            latency_ms: 1,
            reason: 'ok',
            message: 'stub',
        })
        const probeDex = async () => ({
            status: 'ok' as const,
            last_checked: new Date().toISOString(),
            latency_ms: 1,
            reason: 'ok',
            message: 'stub',
        })

        await getPublicStatus({ probeOracle, probeDex })
        await getPublicStatus({ probeOracle, probeDex })

        expect(oracleState.calls).toBe(0)
        expect(dexState.calls).toBe(0)
    })

    it('clamps a hostile cache TTL and defaults when it is not a number', async () => {
        const { getPublicStatusCacheTtlMs } = await loadPublicStatus()

        expect(getPublicStatusCacheTtlMs({ PUBLIC_STATUS_CACHE_TTL_MS: '99999999' })).toBe(300_000)
        expect(getPublicStatusCacheTtlMs({ PUBLIC_STATUS_CACHE_TTL_MS: 'not-a-number' })).toBe(15_000)
        expect(getPublicStatusCacheTtlMs({ PUBLIC_STATUS_CACHE_TTL_MS: '-5' })).toBe(15_000)
        expect(getPublicStatusCacheTtlMs({ PUBLIC_STATUS_CACHE_TTL_MS: '0' })).toBe(0)
        expect(getPublicStatusCacheTtlMs({})).toBe(15_000)
    })
})
