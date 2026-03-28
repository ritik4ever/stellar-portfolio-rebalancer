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
