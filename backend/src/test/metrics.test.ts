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

    it('records cache hit ratio metrics', async () => {
        const { recordCacheHitRatio } = await import('../observability/metrics.js')

        recordCacheHitRatio('XLM', 0.75)
        recordCacheHitRatio('BTC', 0.92)

        const payload = await (await import('../observability/metrics.js')).getMetricsPayload()

        expect(payload).toContain('cache_hit_ratio')
        expect(payload).toContain('asset="XLM"')
        expect(payload).toContain('asset="BTC"')
    })

    it('records cache age histograms in milliseconds', async () => {
        const { recordCacheAge } = await import('../observability/metrics.js')

        recordCacheAge('XLM', 5000)
        recordCacheAge('XLM', 15000)
        recordCacheAge('BTC', 3000)

        const payload = await (await import('../observability/metrics.js')).getMetricsPayload()

        expect(payload).toContain('cache_age_milliseconds')
    })

    it('records cache size and entry count gauges', async () => {
        const { recordCacheSize, recordCacheEntries } = await import('../observability/metrics.js')

        recordCacheSize(4096)
        recordCacheEntries(4)

        const payload = await (await import('../observability/metrics.js')).getMetricsPayload()

        expect(payload).toContain('cache_size_bytes')
        expect(payload).toContain('cache_entries_total')
    })

    it('records cache operations (hit, miss, eviction, update)', async () => {
        const { recordCacheOperation } = await import('../observability/metrics.js')

        recordCacheOperation('hit', 'XLM')
        recordCacheOperation('hit', 'XLM')
        recordCacheOperation('miss', 'BTC')
        recordCacheOperation('update', 'XLM')
        recordCacheOperation('eviction', 'ETH')

        const payload = await (await import('../observability/metrics.js')).getMetricsPayload()

        expect(payload).toContain('cache_operations_total')
        expect(payload).toContain('operation="hit"')
        expect(payload).toContain('operation="miss"')
    })

    it('records cache TTL configuration', async () => {
        const { recordCacheTtl } = await import('../observability/metrics.js')

        recordCacheTtl(600)

        const payload = await (await import('../observability/metrics.js')).getMetricsPayload()

        expect(payload).toContain('cache_ttl_seconds')
    })

    it('records cache expirations by asset', async () => {
        const { recordCacheExpiration } = await import('../observability/metrics.js')

        recordCacheExpiration('XLM')
        recordCacheExpiration('XLM')
        recordCacheExpiration('BTC')

        const payload = await (await import('../observability/metrics.js')).getMetricsPayload()

        expect(payload).toContain('cache_expirations_total')
        expect(payload).toContain('asset="XLM"')
    })
})
