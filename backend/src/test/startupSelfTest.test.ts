import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockProbeRedis = vi.fn()
const mockGetReadiness = vi.fn()
const mockDbClose = vi.fn()
const mockCloseAllQueues = vi.fn()
const mockRunContractDiagnostics = vi.fn()
const mockTestApiConnectivity = vi.fn()
const mockTestOracleReachability = vi.fn()
const mockQueueReady = vi.fn()

vi.mock('../queue/connection.js', () => ({
    probeRedis: mockProbeRedis,
}))

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        getReadiness: mockGetReadiness,
        close: mockDbClose,
    },
}))

vi.mock('../queue/queues.js', () => ({
    QUEUE_NAMES: {
        PORTFOLIO_CHECK: 'portfolio-check',
        REBALANCE: 'rebalance',
        ANALYTICS_SNAPSHOT: 'analytics-snapshot',
        IDEMPOTENCY_CLEANUP: 'idempotency-cleanup',
    },
    getPortfolioCheckQueue: () => ({ waitUntilReady: mockQueueReady }),
    getRebalanceQueue: () => ({ waitUntilReady: mockQueueReady }),
    getAnalyticsSnapshotQueue: () => ({ waitUntilReady: mockQueueReady }),
    getIdempotencyCleanupQueue: () => ({ waitUntilReady: mockQueueReady }),
    closeAllQueues: mockCloseAllQueues,
}))

vi.mock('../services/contractDiagnostics.js', () => ({
    runContractDiagnostics: mockRunContractDiagnostics,
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: function ReflectorService(this: any) {
        this.testApiConnectivity = mockTestApiConnectivity
        this.testOracleReachability = mockTestOracleReachability
    },
}))

const REQUIRED_STARTUP_ENV = {
    NODE_ENV: 'development',
    PORT: '3001',
    STELLAR_NETWORK: 'testnet',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    CONTRACT_ADDRESS: `C${'A'.repeat(55)}`,
    STELLAR_REBALANCE_SECRET: `S${'A'.repeat(55)}`,
}

describe('startupSelfTest', () => {
    let envBackup: NodeJS.ProcessEnv

    beforeEach(() => {
        vi.clearAllMocks()
        envBackup = { ...process.env }
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV }
        mockProbeRedis.mockResolvedValue(true)
        mockGetReadiness.mockReturnValue({
            ready: true,
            databasePath: 'C:/tmp/portfolio.db',
        })
        mockRunContractDiagnostics.mockResolvedValue({
            success: true,
            checks: [],
            summary: {
                totalChecks: 2,
                passedChecks: 2,
                failedChecks: 0,
                connectivityOk: true,
                contractReachable: true,
            },
            timestamp: new Date().toISOString(),
        })
        mockTestApiConnectivity.mockResolvedValue({
            success: true,
            data: {
                status: 200,
            },
        })
        mockTestOracleReachability.mockResolvedValue({
            reachable: true,
            reason: 'ok',
            asset: 'XLM',
            endpoint: 'https://oracle.example',
            latencyMs: 12,
        })
        mockQueueReady.mockResolvedValue(undefined)
        mockDbClose.mockImplementation(() => undefined)
        mockCloseAllQueues.mockResolvedValue(undefined)
    })

    afterEach(() => {
        process.env = envBackup
        vi.restoreAllMocks()
    })

    it('passes when config, database, queues, and providers are healthy', async () => {
        const { runStartupSelfTest, formatStartupSelfTestReport } = await import('../monitoring/startupSelfTest.js')

        const report = await runStartupSelfTest(process.env)

        expect(report.ok).toBe(true)
        expect(report.summary.failedChecks).toBe(0)
        expect(report.checks.map((check) => check.name)).toEqual([
            'config',
            'database',
            'portfolio-check',
            'rebalance',
            'analytics-snapshot',
            'idempotency-cleanup',
            'provider.stellar',
            'provider.price-feed',
            'provider.reflector-oracle',
        ])
        expect(mockCloseAllQueues).toHaveBeenCalledOnce()
        expect(mockDbClose).toHaveBeenCalledOnce()

        const output = formatStartupSelfTestReport(report)
        expect(output).toContain('Self-test passed')
        expect(output).toContain('portfolio-check')
    })

    it('flags queue failures with actionable remediation when Redis is unavailable', async () => {
        mockProbeRedis.mockResolvedValue(false)

        const { runStartupSelfTest } = await import('../monitoring/startupSelfTest.js')
        const report = await runStartupSelfTest(process.env)

        expect(report.ok).toBe(false)
        expect(report.checks.filter((check) => check.name === 'portfolio-check')).toHaveLength(1)
        expect(report.checks.filter((check) => check.status === 'failed').length).toBeGreaterThan(0)
        expect(report.checks.find((check) => check.name === 'portfolio-check')?.remediation).toContain('REDIS_URL')
        expect(mockCloseAllQueues).not.toHaveBeenCalled()
    })

    describe('Reflector oracle reachability (#1405)', () => {
        it('passes when the oracle answers with a fresh quote', async () => {
            const { runStartupSelfTest } = await import('../monitoring/startupSelfTest.js')
            const report = await runStartupSelfTest(process.env)

            const check = report.checks.find((c) => c.name === 'provider.reflector-oracle')!
            expect(check.status).toBe('passed')
            expect(check.message).toContain('reachable')
            expect(report.summary.degradedChecks).toBe(0)
            expect(report.ok).toBe(true)
        })

        it('degrades — but does not fail startup — when the oracle is unreachable', async () => {
            mockTestOracleReachability.mockResolvedValue({
                reachable: false,
                reason: 'unreachable',
                asset: 'XLM',
                endpoint: 'https://oracle.example',
                error: 'getaddrinfo ENOTFOUND oracle.example',
            })

            const { runStartupSelfTest, formatStartupSelfTestReport } = await import('../monitoring/startupSelfTest.js')
            const report = await runStartupSelfTest(process.env)

            const check = report.checks.find((c) => c.name === 'provider.reflector-oracle')!
            expect(check.status).toBe('degraded')
            expect(check.message).toContain('Reflector oracle is unreachable')
            expect(check.remediation).toContain('REFLECTOR_API_URL')
            expect(check.details).toMatchObject({ reason: 'unreachable' })

            // Startup still succeeds — the price feed falls back.
            expect(report.ok).toBe(true)
            expect(report.summary.failedChecks).toBe(0)
            expect(report.summary.degradedChecks).toBe(1)
            expect(formatStartupSelfTestReport(report)).toContain('DEGRADED provider.reflector-oracle')
        })

        it('distinguishes oracle-unreachable from the price-feed check failing', async () => {
            mockTestOracleReachability.mockResolvedValue({
                reachable: false,
                reason: 'unreachable',
                asset: 'XLM',
            })
            mockTestApiConnectivity.mockResolvedValue({ success: false, error: 'coingecko down' })

            const { runStartupSelfTest } = await import('../monitoring/startupSelfTest.js')
            const report = await runStartupSelfTest(process.env)

            const oracle = report.checks.find((c) => c.name === 'provider.reflector-oracle')!
            const priceFeed = report.checks.find((c) => c.name === 'provider.price-feed')!

            expect(oracle.status).toBe('degraded')
            expect(oracle.message).toContain('Reflector oracle')
            expect(priceFeed.status).toBe('failed')
            expect(priceFeed.message).toContain('Price provider')
            // The two diagnostics must not be confusable with one another.
            expect(oracle.message).not.toBe(priceFeed.message)
        })

        it.each([
            ['not_configured', 'not configured', 'Set REFLECTOR_API_URL'],
            ['timeout', 'did not respond in time', 'oracle latency'],
            ['http_error', 'error response', 'endpoint path'],
            ['no_data', 'no price data', 'published by the configured oracle'],
            ['stale', 'stale quotes', 'PRICE_DATA_MAX_AGE'],
        ])('reports a distinct diagnostic for reason=%s', async (reason, messageFragment, remediationFragment) => {
            mockTestOracleReachability.mockResolvedValue({
                reachable: reason === 'stale',
                reason,
                asset: 'XLM',
            })

            const { runStartupSelfTest } = await import('../monitoring/startupSelfTest.js')
            const report = await runStartupSelfTest(process.env)

            const check = report.checks.find((c) => c.name === 'provider.reflector-oracle')!
            expect(check.status).toBe('degraded')
            expect(check.message).toContain(messageFragment)
            expect(check.remediation).toContain(remediationFragment)
        })

        it('degrades when the probe itself throws', async () => {
            mockTestOracleReachability.mockRejectedValue(new Error('client exploded'))

            const { runStartupSelfTest } = await import('../monitoring/startupSelfTest.js')
            const report = await runStartupSelfTest(process.env)

            const check = report.checks.find((c) => c.name === 'provider.reflector-oracle')!
            expect(check.status).toBe('degraded')
            expect(check.message).toContain('threw an error')
            expect(check.details).toMatchObject({ error: 'client exploded' })
            expect(report.ok).toBe(true)
        })
    })

    it('returns a config failure when required startup variables are missing', async () => {
        delete process.env.CONTRACT_ADDRESS
        delete process.env.STELLAR_CONTRACT_ADDRESS

        const { runStartupSelfTest } = await import('../monitoring/startupSelfTest.js')
        const report = await runStartupSelfTest(process.env)

        expect(report.ok).toBe(false)
        expect(report.summary.failedChecks).toBe(1)
        expect(report.checks[0].name).toBe('config')
        expect(report.checks[0].message).toContain('Startup configuration validation failed')
        expect(report.checks[0].remediation).toContain('invalid backend environment variables')
        expect(mockGetReadiness).not.toHaveBeenCalled()
    })
})
