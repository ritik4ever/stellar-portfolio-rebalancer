import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// stellar.ts imports better-sqlite3 at module scope; the native binding is not
// available in this environment, so stub it. The RPC pool does not touch the DB.
vi.mock('better-sqlite3', () => {
  const StubDatabase = vi.fn()
  return { default: StubDatabase }
})

import {
  SorobanRpcEndpointPool,
  resolveSorobanRpcUrls,
} from '../services/stellar.js'

function makeServer(impl: Record<string, unknown> = {}) {
  return {
    getLatestLedger: vi.fn().mockResolvedValue({ sequence: 42 }),
    getEvents: vi.fn().mockResolvedValue({ events: [], latestLedger: 42 }),
    ...impl,
  }
}

describe('SorobanRpcEndpointPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails over to the secondary endpoint when the primary is down', async () => {
    const primary = makeServer({
      getLatestLedger: vi.fn().mockRejectedValue(new Error('connection refused')),
    })
    const secondary = makeServer()

    const factory = vi.fn((url: string) => (url.includes('primary') ? primary : secondary))
    const pool = new SorobanRpcEndpointPool(['http://primary:8000', 'http://secondary:8000'], {
      serverFactory: factory,
    })

    const result = await pool.call((s) => s.getLatestLedger())

    expect(result.sequence).toBe(42)
    expect(primary.getLatestLedger).toHaveBeenCalledTimes(1)
    expect(secondary.getLatestLedger).toHaveBeenCalledTimes(1)
    expect(primary.getLatestLedger).toHaveBeenCalled()
    expect(secondary.getLatestLedger).toHaveBeenCalled()
  })

  it('prefers the responsive secondary on subsequent calls after a primary outage', async () => {
    const primary = makeServer({
      getLatestLedger: vi.fn().mockRejectedValue(new Error('timeout')),
    })
    const secondary = makeServer()

    const factory = vi.fn((url: string) => (url.includes('primary') ? primary : secondary))
    const pool = new SorobanRpcEndpointPool(['http://primary:8000', 'http://secondary:8000'], {
      serverFactory: factory,
    })

    await pool.call((s) => s.getLatestLedger())
    await pool.call((s) => s.getLatestLedger())
    await pool.call((s) => s.getLatestLedger())

    // Primary is cooling down after the failure, so the secondary serves every call.
    expect(primary.getLatestLedger).toHaveBeenCalledTimes(1)
    expect(secondary.getLatestLedger).toHaveBeenCalledTimes(3)
    expect(pool.getStatus().preferredUrl).toBe('http://secondary:8000')
  })

  it('treats a call that exceeds the timeout as a failure and uses the next endpoint', async () => {
    vi.useFakeTimers()
    const primary = makeServer({
      getLatestLedger: vi.fn(() => new Promise(() => { /* never resolves */ })),
    })
    const secondary = makeServer()

    const factory = vi.fn((url: string) => (url.includes('primary') ? primary : secondary))
    const pool = new SorobanRpcEndpointPool(['http://primary:8000', 'http://secondary:8000'], {
      serverFactory: factory,
      timeoutMs: 1000,
    })

    const pending = pool.call((s) => s.getLatestLedger())
    await vi.advanceTimersByTimeAsync(1000)
    const result = await pending

    expect(result.sequence).toBe(42)
    expect(primary.getLatestLedger).toHaveBeenCalledTimes(1)
    expect(secondary.getLatestLedger).toHaveBeenCalledTimes(1)
  })

  it('steers toward the endpoint with the lowest latency once both have samples', async () => {
    const slowPrimary = makeServer()
    const fastSecondary = makeServer()

    const factory = vi.fn((url: string) => (url.includes('primary') ? slowPrimary : fastSecondary))
    const pool = new SorobanRpcEndpointPool(['http://primary:8000', 'http://secondary:8000'], {
      serverFactory: factory,
    })

    // Primary has an accepted latency sample; secondary is faster.
    pool.getEndpointHealths()[0].averageLatencyMs = 200
    pool.getEndpointHealths()[1].averageLatencyMs = 15

    await pool.call((s) => s.getLatestLedger())

    expect(fastSecondary.getLatestLedger).toHaveBeenCalledTimes(1)
    expect(slowPrimary.getLatestLedger).not.toHaveBeenCalled()
  })

  it('re-probes a cooled-down endpoint when no healthy endpoint remains', async () => {
    vi.useFakeTimers()
    const primary = makeServer()
    primary.getLatestLedger.mockRejectedValueOnce(new Error('transient failure'))

    const secondary = makeServer()
    const factory = vi.fn((url: string) => (url.includes('primary') ? primary : secondary))
    const pool = new SorobanRpcEndpointPool(['http://primary:8000', 'http://secondary:8000'], {
      serverFactory: factory,
      cooldownMs: 1000,
    })

    // Initial outage: primary fails, secondary serves the call.
    await pool.call((s) => s.getLatestLedger())
    expect(secondary.getLatestLedger).toHaveBeenCalledTimes(1)

    // Now secondary goes down too. Once primary's cooldown elapses the pool
    // probes it again and restores its health on success.
    await vi.advanceTimersByTimeAsync(1000)
    secondary.getLatestLedger.mockRejectedValue(new Error('secondary down'))
    await pool.call((s) => s.getLatestLedger())

    expect(primary.getLatestLedger).toHaveBeenCalledTimes(2)
    expect(pool.getEndpointHealths()[0].healthy).toBe(true)
    expect(pool.getEndpointHealths()[0].consecutiveFailures).toBe(0)
  })

  it('throws the last error when every endpoint fails', async () => {
    const primary = makeServer({
      getLatestLedger: vi.fn().mockRejectedValue(new Error('boom-a')),
    })
    const secondary = makeServer({
      getLatestLedger: vi.fn().mockRejectedValue(new Error('boom-b')),
    })
    const factory = vi.fn((url: string) => (url.includes('primary') ? primary : secondary))
    const pool = new SorobanRpcEndpointPool(['http://primary:8000', 'http://secondary:8000'], {
      serverFactory: factory,
    })

    await expect(pool.call((s) => s.getLatestLedger())).rejects.toThrow('boom-b')
  })

  it('resolves configured URLs with multiple endpoints preferred over a single one', () => {
    vi.stubEnv('SOROBAN_RPC_URLS', 'http://a, http://b ,http://a')
    vi.stubEnv('SOROBAN_RPC_URL', 'http://legacy')
    try {
      expect(resolveSorobanRpcUrls()).toEqual(['http://a', 'http://b'])
    } finally {
      vi.unstubAllEnvs()
    }
  })
})