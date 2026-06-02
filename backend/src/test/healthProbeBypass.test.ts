/**
 * Health-probe rate-limit bypass tests — issue #464
 *
 * Verifies that trusted health probes (loopback IP or valid X-Probe-Secret)
 * are exempt from ALL rate limiters and CORS origin checks, while public
 * traffic on the same paths is NOT silently whitelisted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { type Request } from 'express'
import request from 'supertest'

// ---------------------------------------------------------------------------
// Helper: build a minimal Express app that applies a single limiter to a
// probe-path route so we can confirm bypass / no-bypass behaviour.
// ---------------------------------------------------------------------------
function buildProbeApp(
    limiter: express.RequestHandler,
    path: string = '/health',
) {
    const app = express()
    // express-rate-limit reads req.ip; supertest sets ::1 (loopback) by default.
    app.set('trust proxy', false)
    app.get(path, limiter, (_req, res) => {
        res.status(200).json({ ok: true })
    })
    return app
}

// ============================================================================
// 1. isTrustedHealthProbe unit tests
// ============================================================================
describe('isTrustedHealthProbe()', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    it('returns true for loopback ::1 on a probe path', async () => {
        const { isTrustedHealthProbe } = await import('../middleware/rateLimit.js')
        const req = {
            path: '/health',
            ip: '::1',
            socket: {},
            headers: {},
        } as unknown as Request
        expect(isTrustedHealthProbe(req)).toBe(true)
    })

    it('returns true for loopback 127.0.0.1 on /readiness', async () => {
        const { isTrustedHealthProbe } = await import('../middleware/rateLimit.js')
        const req = {
            path: '/readiness',
            ip: '127.0.0.1',
            socket: {},
            headers: {},
        } as unknown as Request
        expect(isTrustedHealthProbe(req)).toBe(true)
    })

    it('returns true for ::ffff:127.0.0.1 (IPv4-mapped loopback) on /ready', async () => {
        const { isTrustedHealthProbe } = await import('../middleware/rateLimit.js')
        const req = {
            path: '/ready',
            ip: '::ffff:127.0.0.1',
            socket: {},
            headers: {},
        } as unknown as Request
        expect(isTrustedHealthProbe(req)).toBe(true)
    })

    it('returns false for a non-loopback IP on /health with no secret configured', async () => {
        vi.stubEnv('HEALTH_PROBE_SECRET', '')
        vi.resetModules()
        const { isTrustedHealthProbe } = await import('../middleware/rateLimit.js')
        const req = {
            path: '/health',
            ip: '203.0.113.5',
            socket: {},
            headers: {},
        } as unknown as Request
        expect(isTrustedHealthProbe(req)).toBe(false)
    })

    it('returns true when X-Probe-Secret matches HEALTH_PROBE_SECRET from external IP', async () => {
        vi.stubEnv('HEALTH_PROBE_SECRET', 'super-secret-probe')
        vi.resetModules()
        const { isTrustedHealthProbe } = await import('../middleware/rateLimit.js')
        const req = {
            path: '/ready',
            ip: '10.0.0.5',
            socket: {},
            headers: { 'x-probe-secret': 'super-secret-probe' },
        } as unknown as Request
        expect(isTrustedHealthProbe(req)).toBe(true)
    })

    it('returns false when X-Probe-Secret is wrong', async () => {
        vi.stubEnv('HEALTH_PROBE_SECRET', 'super-secret-probe')
        vi.resetModules()
        const { isTrustedHealthProbe } = await import('../middleware/rateLimit.js')
        const req = {
            path: '/ready',
            ip: '10.0.0.5',
            socket: {},
            headers: { 'x-probe-secret': 'wrong-secret' },
        } as unknown as Request
        expect(isTrustedHealthProbe(req)).toBe(false)
    })

    it('returns false when the path is not a probe path, even from loopback', async () => {
        const { isTrustedHealthProbe } = await import('../middleware/rateLimit.js')
        const req = {
            path: '/api/v1/portfolios',
            ip: '127.0.0.1',
            socket: {},
            headers: {},
        } as unknown as Request
        expect(isTrustedHealthProbe(req)).toBe(false)
    })

    it('returns false when HEALTH_PROBE_SECRET is empty and header is present from external IP', async () => {
        vi.stubEnv('HEALTH_PROBE_SECRET', '')
        vi.resetModules()
        const { isTrustedHealthProbe } = await import('../middleware/rateLimit.js')
        const req = {
            path: '/health',
            ip: '198.51.100.1',
            socket: {},
            headers: { 'x-probe-secret': 'anything' },
        } as unknown as Request
        // No secret configured → external IP should not be bypassed
        expect(isTrustedHealthProbe(req)).toBe(false)
    })
})

// ============================================================================
// 2. Rate-limiter skip on probe paths (integration-style via supertest)
//    supertest uses loopback (::1) so bypass should always engage.
// ============================================================================
describe('Rate limiters: probe paths are skipped (loopback)', () => {
    beforeEach(() => {
        vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000')
        vi.stubEnv('NODE_ENV', 'test')
        vi.resetModules()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('globalRateLimiter skips /health', async () => {
        vi.stubEnv('RATE_LIMIT_MAX', '1')
        vi.resetModules()
        const { globalRateLimiter } = await import('../middleware/rateLimit.js')
        const app = buildProbeApp(globalRateLimiter, '/health')
        // First request uses the 1-request budget
        await request(app).get('/health').expect(200)
        // Second request must also pass because probes are skipped
        const res = await request(app).get('/health').expect(200)
        expect(res.body.ok).toBe(true)
    })

    it('writeRateLimiter skips /ready', async () => {
        vi.stubEnv('RATE_LIMIT_WRITE_MAX', '1')
        vi.resetModules()
        const { writeRateLimiter } = await import('../middleware/rateLimit.js')
        const app = buildProbeApp(writeRateLimiter, '/ready')
        await request(app).get('/ready').expect(200)
        await request(app).get('/ready').expect(200)
    })

    it('burstProtectionLimiter skips /readiness', async () => {
        vi.stubEnv('RATE_LIMIT_BURST_MAX', '1')
        vi.resetModules()
        const { burstProtectionLimiter } = await import('../middleware/rateLimit.js')
        const app = buildProbeApp(burstProtectionLimiter, '/readiness')
        await request(app).get('/readiness').expect(200)
        await request(app).get('/readiness').expect(200)
    })

    it('authRateLimiter skips /health', async () => {
        vi.stubEnv('RATE_LIMIT_AUTH_MAX', '1')
        vi.resetModules()
        const { authRateLimiter } = await import('../middleware/rateLimit.js')
        const app = buildProbeApp(authRateLimiter, '/health')
        await request(app).get('/health').expect(200)
        await request(app).get('/health').expect(200)
    })

    it('criticalRateLimiter skips /health', async () => {
        vi.stubEnv('RATE_LIMIT_CRITICAL_MAX', '1')
        vi.resetModules()
        const { criticalRateLimiter } = await import('../middleware/rateLimit.js')
        const app = buildProbeApp(criticalRateLimiter, '/health')
        await request(app).get('/health').expect(200)
        await request(app).get('/health').expect(200)
    })

    it('adminRateLimiter skips /health', async () => {
        vi.stubEnv('RATE_LIMIT_AUTH_MAX', '1')
        vi.resetModules()
        const { adminRateLimiter } = await import('../middleware/rateLimit.js')
        const app = buildProbeApp(adminRateLimiter, '/health')
        await request(app).get('/health').expect(200)
        await request(app).get('/health').expect(200)
    })
})

// ============================================================================
// 3. Rate limiter still enforces limits on non-probe paths
// ============================================================================
describe('Rate limiters: non-probe paths are NOT exempt', () => {
    beforeEach(() => {
        vi.stubEnv('NODE_ENV', 'test')
        vi.resetModules()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('writeRateLimiter throttles /api/v1/test after limit is reached', async () => {
        vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000')
        vi.stubEnv('RATE_LIMIT_WRITE_MAX', '1')
        vi.resetModules()
        const { writeRateLimiter } = await import('../middleware/rateLimit.js')
        const app = express()
        app.post('/api/v1/test', writeRateLimiter, (_req, res) => res.json({ ok: true }))

        await request(app).post('/api/v1/test').expect(200)
        const second = await request(app).post('/api/v1/test').expect(429)
        expect(second.body.error?.code).toBe('RATE_LIMITED')
    })
})

// ============================================================================
// 4. CORS allowlist: probe paths bypass the origin check
// ============================================================================
describe('enforceCorsOriginAllowlist: probe path bypass', () => {
    it('allows /health even when origin is not in the allowlist', async () => {
        const { enforceCorsOriginAllowlist } = await import('../http/corsSecurity.js')
        const app = express()
        // Strict allowlist — only example.com
        app.use(enforceCorsOriginAllowlist(['https://app.example.com']))
        app.get('/health', (_req, res) => res.status(200).send('ok'))

        // Request from an "evil" origin should still get through on /health
        const res = await request(app)
            .get('/health')
            .set('Origin', 'https://evil.example.com')
            .expect(200)
        expect(res.text).toBe('ok')
    })

    it('allows /ready without any origin header', async () => {
        const { enforceCorsOriginAllowlist } = await import('../http/corsSecurity.js')
        const app = express()
        app.use(enforceCorsOriginAllowlist(['https://app.example.com']))
        app.get('/ready', (_req, res) => res.status(200).send('ok'))

        await request(app).get('/ready').expect(200)
    })

    it('allows /readiness from any origin', async () => {
        const { enforceCorsOriginAllowlist } = await import('../http/corsSecurity.js')
        const app = express()
        app.use(enforceCorsOriginAllowlist(['https://app.example.com']))
        app.get('/readiness', (_req, res) => res.status(200).send('ok'))

        await request(app)
            .get('/readiness')
            .set('Origin', 'https://monitoring.internal')
            .expect(200)
    })

    it('still rejects unlisted origins on non-probe paths', async () => {
        const { enforceCorsOriginAllowlist } = await import('../http/corsSecurity.js')
        const app = express()
        app.use(enforceCorsOriginAllowlist(['https://app.example.com']))
        app.get('/api/v1/portfolios', (_req, res) => res.json({ ok: true }))

        const res = await request(app)
            .get('/api/v1/portfolios')
            .set('Origin', 'https://evil.example.com')
            .expect(403)
        expect(res.body.error?.code).toBe('CORS_FORBIDDEN_ORIGIN')
    })
})

// ============================================================================
// 5. Readiness report includes probeBypass metadata
// ============================================================================
describe('buildReadinessReport: probeBypass metadata', () => {
    beforeEach(() => {
        vi.resetModules()

        vi.doMock('../services/databaseService.js', () => ({
            databaseService: {
                getReadiness: vi.fn().mockReturnValue({ ready: true })
            }
        }))
        vi.doMock('../queue/connection.js', () => ({
            isRedisAvailable: vi.fn().mockResolvedValue(false)
        }))
        vi.doMock('../queue/queues.js', () => ({
            QUEUE_NAMES: {
                PORTFOLIO_CHECK: 'portfolio-check',
                REBALANCE: 'rebalance',
                ANALYTICS_SNAPSHOT: 'analytics-snapshot',
            },
            getPortfolioCheckQueue: vi.fn().mockReturnValue(null),
            getRebalanceQueue: vi.fn().mockReturnValue(null),
            getAnalyticsSnapshotQueue: vi.fn().mockReturnValue(null),
        }))
        vi.doMock('../queue/workers/portfolioCheckWorker.js', () => ({
            getPortfolioCheckWorkerStatus: vi.fn().mockReturnValue({ started: false, ready: false })
        }))
        vi.doMock('../queue/workers/rebalanceWorker.js', () => ({
            getRebalanceWorkerStatus: vi.fn().mockReturnValue({ started: false, ready: false })
        }))
        vi.doMock('../queue/workers/analyticsSnapshotWorker.js', () => ({
            getAnalyticsSnapshotWorkerStatus: vi.fn().mockReturnValue({ started: false, ready: false })
        }))
        vi.doMock('../services/contractEventIndexer.js', () => ({
            contractEventIndexerService: {
                getStatus: vi.fn().mockReturnValue({
                    enabled: false,
                    running: false,
                    pollIntervalMs: 15000,
                    lastIngestedCount: 0,
                    contractEventSchemaOk: true,
                    consecutiveFailures: 0,
                })
            }
        }))
        vi.doMock('../services/runtimeServices.js', () => ({
            autoRebalancer: {
                getStatus: vi.fn().mockReturnValue({ isRunning: false, initialized: false })
            }
        }))
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
    })

    it('includes probeBypass with correct probe paths', async () => {
        const { buildReadinessReport, clearReadinessCache } = await import('../monitoring/readiness.js')
        clearReadinessCache()
        const report = await buildReadinessReport() as Record<string, unknown>
        const bypass = report.probeBypass as Record<string, unknown>

        expect(bypass).toBeDefined()
        expect(bypass.probePaths).toEqual(['/health', '/ready', '/readiness', '/metrics'])
        expect(bypass.loopbackBypassEnabled).toBe(true)
    })

    it('reflects secretConfigured=false when HEALTH_PROBE_SECRET is unset', async () => {
        delete process.env.HEALTH_PROBE_SECRET
        const { buildReadinessReport, clearReadinessCache } = await import('../monitoring/readiness.js')
        clearReadinessCache()
        const report = await buildReadinessReport() as Record<string, unknown>
        const bypass = report.probeBypass as Record<string, unknown>
        expect(bypass.secretConfigured).toBe(false)
    })

    it('reflects secretConfigured=true when HEALTH_PROBE_SECRET is set', async () => {
        vi.stubEnv('HEALTH_PROBE_SECRET', 'my-k8s-secret')
        const { buildReadinessReport, clearReadinessCache } = await import('../monitoring/readiness.js')
        clearReadinessCache()
        const report = await buildReadinessReport() as Record<string, unknown>
        const bypass = report.probeBypass as Record<string, unknown>
        expect(bypass.secretConfigured).toBe(true)
    })

    it('does NOT include the secret value in the report', async () => {
        vi.stubEnv('HEALTH_PROBE_SECRET', 'my-k8s-secret')
        const { buildReadinessReport, clearReadinessCache } = await import('../monitoring/readiness.js')
        clearReadinessCache()
        const reportJson = JSON.stringify(await buildReadinessReport())
        expect(reportJson).not.toContain('my-k8s-secret')
    })
})
