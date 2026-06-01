import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../services/stellar.js', () => {
    function StellarService(this: any) {}
    StellarService.prototype.getPortfolio = vi.fn().mockResolvedValue({
        id: 'portfolio-drifting',
        userAddress: 'GTEST123456789',
        allocations: { XLM: 60, USDC: 40 },
        balances: { XLM: 1000, USDC: 400 },
        totalValue: 1000,
        threshold: 5,
        lastRebalance: new Date(Date.now() - 25 * 3600000).toISOString(),
    })
    StellarService.prototype.checkRebalanceNeeded = vi.fn().mockResolvedValue(true)
    StellarService.prototype.executeRebalance = vi.fn().mockResolvedValue({ trades: 2, gasUsed: '0.01 XLM' })
    return { StellarService }
})

vi.mock('../services/reflector.js', () => {
    function ReflectorService(this: any) {
        this.getCurrentPrices = vi.fn().mockResolvedValue({
            XLM: { price: 0.35, change: -0.5, timestamp: Date.now() / 1000 },
            USDC: { price: 1.0, change: 0.0, timestamp: Date.now() / 1000 },
        })
    }
    return { ReflectorService }
})

vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: {
        recordRebalanceEvent: vi.fn().mockResolvedValue({ id: 'hist-1' }),
        getRecentAutoRebalances: vi.fn().mockResolvedValue([]),
        getAutoRebalancesSince: vi.fn().mockResolvedValue([]),
        getAllAutoRebalances: vi.fn().mockResolvedValue([]),
        getHistoryStats: vi.fn().mockResolvedValue({})
    },
    riskManagementService: {
        shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true, reason: 'OK', alerts: [] }),
        updatePriceData: vi.fn().mockReturnValue([]),
        getCircuitBreakerStatus: vi.fn().mockReturnValue({})
    }
}))

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: {
        getAllPortfolios: vi.fn().mockResolvedValue([
            { id: 'portfolio-drifting', threshold: 5 },
            { id: 'portfolio-stable', threshold: 5 },
        ]),
        getPortfolio: vi.fn().mockReturnValue({ id: 'portfolio-drifting', threshold: 5 }),
    },
}))

vi.mock('../services/circuitBreakers.js', () => ({
    CircuitBreakers: {
        checkMarketConditions: vi.fn().mockResolvedValue({ safe: true }),
        checkCooldownPeriod: vi.fn().mockReturnValue({ safe: true }),
        checkConcentrationRisk: vi.fn().mockReturnValue({ safe: true }),
    },
}))

vi.mock('../services/notificationService.js', () => ({
    notificationService: { notify: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('../services/rebalanceLock.js', () => ({
    rebalanceLockService: {
        acquireLock: vi.fn().mockResolvedValue(true),
        releaseLock: vi.fn().mockResolvedValue(true),
        isLocked: vi.fn().mockResolvedValue(false),
    },
}))

vi.mock('../queue/queues.js', () => ({
    getRebalanceQueue: vi.fn().mockReturnValue({
        add: vi.fn().mockResolvedValue({ id: 'job-rebalance-1' }),
    }),
    QUEUE_NAMES: {
        PORTFOLIO_CHECK: 'portfolio-check',
        REBALANCE: 'rebalance',
        ANALYTICS_SNAPSHOT: 'analytics-snapshot',
    },
}))

vi.mock('../queue/connection.js', () => ({
    getConnectionOptions: vi.fn().mockReturnValue({ url: 'redis://localhost:6379' }),
    isRedisAvailable: vi.fn().mockResolvedValue(true),
    logQueueStartup: vi.fn(),
    REDIS_URL: 'redis://localhost:6379',
}))

// ─── Imports ─────────────────────────────────────────────────────────────────

import { processPortfolioCheckJob } from '../queue/workers/portfolioCheckWorker.js'
import { processRebalanceJob } from '../queue/workers/rebalanceWorker.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { getRebalanceQueue } from '../queue/queues.js'
import { StellarService } from '../services/stellar.js'
import { rebalanceHistoryService } from '../services/serviceContainer.js'

function mockJob<T>(data: T, id = 'test-job-1', attemptsMade = 0): Job<T> {
    return { id, data, attemptsMade } as unknown as Job<T>
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AutoRebalancer Pipeline Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Setup initial mocked state
        ;(portfolioStorage.getAllPortfolios as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 'portfolio-drifting', threshold: 5 },
            { id: 'portfolio-stable', threshold: 5 },
        ])
        const queue = getRebalanceQueue()
        if (queue) {
            ;(queue.add as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job-1' })
        }
        ;(StellarService.prototype.checkRebalanceNeeded as ReturnType<typeof vi.fn>).mockImplementation(
            async (id: string) => id === 'portfolio-drifting'
        )
    })

    it('should simulate a portfolio drifting beyond threshold and trigger full rebalance pipeline', async () => {
        // 1. Simulate drift detection by running the portfolio check worker
        await processPortfolioCheckJob(mockJob({ triggeredBy: 'scheduler' as const }))
        
        // 2. Verify rebalance job was enqueued ONLY for the drifting portfolio
        const queue = getRebalanceQueue()
        expect(queue!.add).toHaveBeenCalledWith(
            'rebalance-portfolio-drifting',
            expect.objectContaining({ portfolioId: 'portfolio-drifting', triggeredBy: 'auto' }),
            expect.anything()
        )
        expect(queue!.add).not.toHaveBeenCalledWith(
            'rebalance-portfolio-stable',
            expect.anything(),
            expect.anything()
        )

        // 3. Extract the enqueued job payload to simulate the queue picking it up
        const enqueueCall = (queue!.add as ReturnType<typeof vi.fn>).mock.calls.find(
            call => call[0] === 'rebalance-portfolio-drifting'
        )
        expect(enqueueCall).toBeDefined()
        const jobData = enqueueCall[1]

        // 4. Run the rebalance execution worker manually
        await processRebalanceJob(mockJob(jobData))

        // 5. Verify Stellar execution was called with correct parameters
        expect(StellarService.prototype.executeRebalance).toHaveBeenCalledWith('portfolio-drifting')
        
        // 6. Verify history recorded with correct details ('auto' trigger type mapped to Automatic Rebalancing)
        expect(rebalanceHistoryService.recordRebalanceEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                portfolioId: 'portfolio-drifting',
                trigger: 'Automatic Rebalancing',
                status: 'completed',
                isAutomatic: true,
            })
        )
    })

    it('should simulate a portfolio within threshold and verify no rebalance occurs', async () => {
        // Mock only the stable portfolio existing (or rely on beforeEach logic)
        ;(portfolioStorage.getAllPortfolios as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 'portfolio-stable', threshold: 5 }
        ])
        
        await processPortfolioCheckJob(mockJob({ triggeredBy: 'scheduler' as const }))
        
        // Ensure no jobs were added to the rebalance queue
        const queue = getRebalanceQueue()
        expect(queue!.add).not.toHaveBeenCalled()
    })
})
