import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockProbeRedis = vi.fn()
const mockGetReadiness = vi.fn()
const mockDbClose = vi.fn()
const mockCloseAllQueues = vi.fn()
const mockRunContractDiagnostics = vi.fn()
const mockTestApiConnectivity = vi.fn()
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
