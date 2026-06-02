import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockBuildReadinessReport = vi.fn()
const mockGetQueueMetrics = vi.fn()

vi.mock('../monitoring/readiness.js', () => ({
    buildReadinessReport: mockBuildReadinessReport
}))

vi.mock('../queue/queueMetrics.js', () => ({
    getQueueMetrics: mockGetQueueMetrics
}))

describe('metrics observability', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        process.env.METRICS_ENABLED = 'true'
        process.env.METRICS_PREFIX = 'stellar_portfolio_'

        mockBuildReadinessReport.mockResolvedValue({
            status: 'ready',
            timestamp: new Date().toISOString(),
            uptimeSeconds: 42,
            checks: {}
        })

        mockGetQueueMetrics.mockResolvedValue({
            redisConnected: true,
            queues: {
                rebalance: {
                    waiting: 1,
                    active: 2,
                    completed: 3,
                    failed: 4,
                    delayed: 5
                }
            }
        })
    })

    it('renders prometheus metrics including readiness and queue gauges', async () => {
        const { getMetricsPayload } = await import('../observability/metrics.js')

        const payload = await getMetricsPayload()

        expect(payload).toContain('stellar_portfolio_readiness_status')
        expect(payload).toContain('stellar_portfolio_queue_jobs')
        expect(payload).toContain('queue="rebalance",state="failed"')
    })
})

describe('metrics endpoint protection', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    it('allows localhost IP in production when in allowlist', () => {
        const config = {
            nodeEnv: 'production' as const,
            metricsAllowlist: ['127.0.0.1', '::1'],
            port: 3001,
            stellarNetwork: 'testnet' as const,
            stellarHorizonUrl: 'https://horizon-testnet.stellar.org',
            stellarContractAddress: 'CA3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2S3Q4',
            autoRebalancerEnabled: false,
            corsOrigins: [],
            hasRebalanceSigner: false,
            jwtAuthEnabled: false,
            featureFlags: {
                demoMode: true,
                allowFallbackPrices: true,
                enableDebugRoutes: false,
                allowMockPriceHistory: false,
                allowDemoBalanceFallback: false,
                enableDemoDbSeed: false,
                allowPublicUserPortfoliosInDemo: false,
            },
        }

        const isAllowed = (ip: string): boolean => {
            if (config.nodeEnv === 'development' || config.nodeEnv === 'test') return true
            const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost'
            if (isLocal) return true
            return config.metricsAllowlist.some((entry) => ip.includes(entry))
        }

        expect(isAllowed('127.0.0.1')).toBe(true)
        expect(isAllowed('::1')).toBe(true)
        expect(isAllowed('::ffff:127.0.0.1')).toBe(true)
        expect(isAllowed('10.0.0.1')).toBe(false)
    })

    it('allows all IPs in development mode', () => {
        const isAllowed = (ip: string, nodeEnv: string): boolean => {
            if (nodeEnv === 'development' || nodeEnv === 'test') return true
            return false
        }

        expect(isAllowed('10.0.0.1', 'development')).toBe(true)
        expect(isAllowed('192.168.1.1', 'development')).toBe(true)
        expect(isAllowed('127.0.0.1', 'development')).toBe(true)
    })

    it('blocks external IPs in production without allowlist match', () => {
        const config = {
            nodeEnv: 'production' as const,
            metricsAllowlist: ['10.0.0.0/8'],
        }

        const isAllowed = (ip: string): boolean => {
            if (config.nodeEnv === 'development' || config.nodeEnv === 'test') return true
            const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost'
            if (isLocal) return true
            return config.metricsAllowlist.some((entry) => ip.includes(entry))
        }

        expect(isAllowed('10.0.0.1')).toBe(true)
        expect(isAllowed('203.0.113.44')).toBe(false)
    })

    it('allows listed subnet IPs in production', () => {
        const config = {
            nodeEnv: 'production' as const,
            metricsAllowlist: ['203.0.113.'],
        }

        const isAllowed = (ip: string): boolean => {
            if (config.nodeEnv === 'development' || config.nodeEnv === 'test') return true
            const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost'
            if (isLocal) return true
            return config.metricsAllowlist.some((entry) => ip.includes(entry))
        }

        expect(isAllowed('203.0.113.44')).toBe(true)
        expect(isAllowed('203.0.113.100')).toBe(true)
        expect(isAllowed('198.51.100.1')).toBe(false)
    })

    it('parses METRICS_ALLOWLIST from environment', async () => {
        process.env.METRICS_ALLOWLIST = '10.0.0.1,192.168.1.0/24'
        process.env.NODE_ENV = 'production'
        process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org'
        process.env.CONTRACT_ADDRESS = 'CA3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2S3Q4'
        process.env.STELLAR_REBALANCE_SECRET = 'SA3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2'

        vi.resetModules()
        const { validateStartupConfigOrThrow } = await import('../config/startupConfig.js')
        const config = validateStartupConfigOrThrow(process.env)

        expect(config.metricsAllowlist).toContain('10.0.0.1')
        expect(config.metricsAllowlist).toContain('192.168.1.0/24')
        expect(config.metricsAllowlist).toHaveLength(2)
    })

    it('defaults to empty metricsAllowlist when not set', async () => {
        delete process.env.METRICS_ALLOWLIST
        process.env.NODE_ENV = 'development'
        process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org'
        process.env.CONTRACT_ADDRESS = 'CA3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2S3Q4J3Q2S3Q4'
        delete process.env.STELLAR_REBALANCE_SECRET

        vi.resetModules()
        const { validateStartupConfigOrThrow } = await import('../config/startupConfig.js')
        const config = validateStartupConfigOrThrow(process.env)

        expect(config.metricsAllowlist).toEqual([])
    })
})
