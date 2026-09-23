import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Job } from 'bullmq'
import type { AutoRebalanceCheckJobData } from '../queue/queues.js'

// ── Shared mocks (hoisted so vi.mock factories can reference them) ──────────
const mocks = vi.hoisted(() => ({
    queueAdd: vi.fn().mockResolvedValue({ id: 'job-1' }),
    checkRebalanceNeeded: vi.fn().mockResolvedValue(true),
    shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true, reason: 'OK', alerts: [] }),
    checkCVaRVaRThresholdsAndAutoPause: vi.fn().mockResolvedValue({}),
    getAllPortfolios: vi.fn(),
    getCurrentPrices: vi.fn(),
    checkCooldownPeriod: vi.fn().mockReturnValue({ safe: true }),
    checkMarketConditions: vi.fn().mockReturnValue({ safe: true }),
}))

vi.mock('bullmq', () => ({
    Job: class {},
    Worker: class {},
}))

vi.mock('../utils/requestContext.js', () => ({
    runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
}))

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logAudit: vi.fn(),
}))

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: { getAllPortfolios: mocks.getAllPortfolios },
}))

vi.mock('../services/stellar.js', () => {
    class StellarService {
        checkRebalanceNeeded = mocks.checkRebalanceNeeded
    }
    return { StellarService }
})

vi.mock('../services/reflector.js', () => {
    class ReflectorService {
        getCurrentPrices = mocks.getCurrentPrices
    }
    return { ReflectorService }
})

vi.mock('../services/serviceContainer.js', () => ({
    riskManagementService: {
        shouldAllowRebalance: mocks.shouldAllowRebalance,
        checkCVaRVaRThresholdsAndAutoPause: mocks.checkCVaRVaRThresholdsAndAutoPause,
    },
}))

vi.mock('../services/circuitBreakers.js', () => ({
    CircuitBreakers: {
        checkMarketConditions: mocks.checkMarketConditions,
        checkCooldownPeriod: mocks.checkCooldownPeriod,
    },
}))

vi.mock('../queue/queues.js', () => ({
    getRebalanceQueue: () => ({ add: mocks.queueAdd }),
}))

vi.mock('../queue/connection.js', () => ({
    getConnectionOptions: () => ({}),
}))

vi.mock('../queue/workers/workerRuntime.js', () => ({
    createWorkerRuntimeStatus: () => ({ schedulerRegistered: false }),
    markWorkerFailed: vi.fn(),
    markWorkerJobCompleted: vi.fn(),
    markWorkerJobFailed: vi.fn(),
    markWorkerReady: vi.fn(),
    markWorkerStarting: vi.fn(),
    markWorkerStopped: vi.fn(),
    snapshotWorkerRuntimeStatus: vi.fn(),
    handleFinalFailure: vi.fn(),
}))

import { isRiskPaused, processAutoRebalanceJob } from '../jobs/autoRebalance.js'
import type { Portfolio } from '../types/index.js'

const PRICES = {
    XLM: { price: 0.35, change: 0, timestamp: 1, source: 'external' as const },
    USDC: { price: 1.0, change: 0, timestamp: 1, source: 'external' as const },
}

const DAY_MS = 24 * 60 * 60 * 1000

const mockJob = (overrides: Partial<Job<AutoRebalanceCheckJobData>> = {}): Job<AutoRebalanceCheckJobData> =>
    ({
        id: 'job-1',
        data: { triggeredBy: 'scheduler', correlationId: 'corr-1' },
        ...overrides,
    }) as unknown as Job<AutoRebalanceCheckJobData>

const dcaPortfolio = (overrides: Partial<Portfolio> = {}): Portfolio => {
    const now = Date.now()
    return {
        id: 'p-dca',
        userAddress: 'GTEST',
        allocations: { XLM: 50, USDC: 50 },
        threshold: 5,
        strategy: 'dca',
        strategyConfig: { dcaAmount: 100, dcaIntervalDays: 7 },
        balances: { XLM: 200, USDC: 100 },
        totalValue: 170,
        createdAt: new Date(now - 30 * DAY_MS).toISOString(),
        // Due: 8 days since the last buy with a 7-day interval.
        lastRebalance: new Date(now - 8 * DAY_MS).toISOString(),
        version: 1,
        ...overrides,
    }
}

const thresholdPortfolio = (overrides: Partial<Portfolio> = {}): Portfolio => ({
    id: 'p-threshold',
    userAddress: 'GTEST',
    allocations: { XLM: 50, USDC: 50 },
    threshold: 5,
    balances: { XLM: 200, USDC: 100 },
    totalValue: 170,
    createdAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    lastRebalance: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    version: 1,
    ...overrides,
})

describe('processAutoRebalanceJob — strategy dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getCurrentPrices.mockResolvedValue(PRICES)
        mocks.shouldAllowRebalance.mockReturnValue({ allowed: true, reason: 'OK', alerts: [] })
        mocks.checkCooldownPeriod.mockReturnValue({ safe: true })
        mocks.checkMarketConditions.mockReturnValue({ safe: true })
        mocks.checkRebalanceNeeded.mockResolvedValue(true)
        delete process.env.ENABLE_REBALANCE_CROSS_CHECK
        delete process.env.REBALANCE_CROSS_CHECK_REQUIRE_AGREEMENT
    })

    afterEach(() => {
        delete process.env.ENABLE_REBALANCE_CROSS_CHECK
        delete process.env.REBALANCE_CROSS_CHECK_REQUIRE_AGREEMENT
    })

    it('triggers a DCA portfolio when its interval cadence is due', async () => {
        mocks.getAllPortfolios.mockResolvedValue([dcaPortfolio()])

        const summary = await processAutoRebalanceJob(mockJob())

        expect(summary.portfoliosTriggered).toBe(1)
        expect(mocks.queueAdd).toHaveBeenCalledWith(
            'rebalance-p-dca',
            expect.objectContaining({ portfolioId: 'p-dca', triggeredBy: 'auto' }),
            expect.anything()
        )
    })

    it('does not enqueue a DCA portfolio when the interval has not elapsed', async () => {
        mocks.getAllPortfolios.mockResolvedValue([
            dcaPortfolio({ lastRebalance: new Date(Date.now() - 1 * DAY_MS).toISOString() }),
        ])

        const summary = await processAutoRebalanceJob(mockJob())

        expect(summary.portfoliosTriggered).toBe(0)
        expect(mocks.queueAdd).not.toHaveBeenCalled()
        expect(summary.portfoliosSkipped).toEqual(
            expect.arrayContaining([expect.objectContaining({ reason: 'dca_not_due', count: 1 })])
        )
    })

    it('does not trigger DCA when the strategy config disables the strategy', async () => {
        mocks.getAllPortfolios.mockResolvedValue([
            dcaPortfolio({ strategyConfig: { dcaAmount: 100, dcaIntervalDays: 7, enabled: false } }),
        ])

        const summary = await processAutoRebalanceJob(mockJob())

        expect(summary.portfoliosChecked).toBe(0)
        expect(mocks.queueAdd).not.toHaveBeenCalled()
    })

    it('preserves the drift-based threshold behaviour for threshold portfolios', async () => {
        mocks.getAllPortfolios.mockResolvedValue([thresholdPortfolio()])

        const summary = await processAutoRebalanceJob(mockJob())

        expect(summary.portfoliosTriggered).toBe(1)
        expect(mocks.queueAdd).toHaveBeenCalledWith(
            'rebalance-p-threshold',
            expect.objectContaining({ portfolioId: 'p-threshold' }),
            expect.anything()
        )
    })
})
describe('processAutoRebalanceJob — CVaR/VaR auto-pause integration', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getCurrentPrices.mockResolvedValue(PRICES)
        mocks.checkCooldownPeriod.mockReturnValue({ safe: true })
        mocks.checkMarketConditions.mockReturnValue({ safe: true })
        mocks.checkRebalanceNeeded.mockResolvedValue(true)
    })

    it('skips portfolios that are already auto-paused (riskPausedUntil in the future)', async () => {
        mocks.getAllPortfolios.mockResolvedValue([
            dcaPortfolio({
                riskPausedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            }),
        ])

        const summary = await processAutoRebalanceJob(mockJob())

        expect(summary.portfoliosTriggered).toBe(0)
        expect(mocks.queueAdd).not.toHaveBeenCalled()
        expect(summary.portfoliosSkipped).toEqual(
            expect.arrayContaining([expect.objectContaining({ reason: 'risk_paused', count: 1 })])
        )
    })

    it('fires the auto-pause guardrail when the stat model blocks a VaR breach and then skips', async () => {
        mocks.getAllPortfolios.mockResolvedValue([dcaPortfolio()])
        mocks.shouldAllowRebalance.mockReturnValue({
            allowed: false,
            reason: 'Rebalance blocked by VaR limit',
            reasonCode: 'STAT_MODEL_VAR_BREACH',
            alerts: [],
        })

        const summary = await processAutoRebalanceJob(mockJob())

        expect(mocks.checkCVaRVaRThresholdsAndAutoPause).toHaveBeenCalledWith(
            'p-dca',
            { XLM: 50, USDC: 50 },
            PRICES,
            'GTEST'
        )
        expect(mocks.queueAdd).not.toHaveBeenCalled()
        expect(summary.portfoliosSkipped).toEqual(
            expect.arrayContaining([expect.objectContaining({ reason: 'risk_paused', count: 1 })])
        )
    })

    it('does not fire the auto-pause guardrail for non-VaR/CVaR blocks', async () => {
        mocks.getAllPortfolios.mockResolvedValue([dcaPortfolio()])
        mocks.shouldAllowRebalance.mockReturnValue({
            allowed: false,
            reason: 'Circuit breaker active',
            reasonCode: 'CIRCUIT_BREAKER_ACTIVE',
            alerts: [],
        })

        const summary = await processAutoRebalanceJob(mockJob())

        expect(mocks.checkCVaRVaRThresholdsAndAutoPause).not.toHaveBeenCalled()
        expect(mocks.queueAdd).not.toHaveBeenCalled()
        expect(summary.portfoliosSkipped).toEqual(
            expect.arrayContaining([expect.objectContaining({ reason: 'circuit_breaker', count: 1 })])
        )
    })
})
describe('processAutoRebalanceJob — on-chain cross-check', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getCurrentPrices.mockResolvedValue(PRICES)
        mocks.shouldAllowRebalance.mockReturnValue({ allowed: true, reason: 'OK', alerts: [] })
        mocks.checkCooldownPeriod.mockReturnValue({ safe: true })
        mocks.checkMarketConditions.mockReturnValue({ safe: true })
        mocks.getAllPortfolios.mockResolvedValue([dcaPortfolio()])
    })

    afterEach(() => {
        delete process.env.ENABLE_REBALANCE_CROSS_CHECK
        delete process.env.REBALANCE_CROSS_CHECK_REQUIRE_AGREEMENT
    })

    it('blocks execution when the on-chain check disagrees and requireAgreement is enabled', async () => {
        process.env.ENABLE_REBALANCE_CROSS_CHECK = 'true'
        process.env.REBALANCE_CROSS_CHECK_REQUIRE_AGREEMENT = 'true'
        mocks.checkRebalanceNeeded.mockResolvedValue(false) // disagrees with the backend DCA decision

        const summary = await processAutoRebalanceJob(mockJob())

        expect(summary.portfoliosTriggered).toBe(0)
        expect(mocks.queueAdd).not.toHaveBeenCalled()
        expect(summary.portfoliosSkipped).toEqual(
            expect.arrayContaining([expect.objectContaining({ reason: 'crosscheck_disagreement', count: 1 })])
        )
    })

    it('warns but still executes on disagreement in warn-only mode', async () => {
        process.env.ENABLE_REBALANCE_CROSS_CHECK = 'true'
        mocks.checkRebalanceNeeded.mockResolvedValue(false) // disagrees with the backend DCA decision

        const summary = await processAutoRebalanceJob(mockJob())

        expect(summary.portfoliosTriggered).toBe(1)
        expect(mocks.queueAdd).toHaveBeenCalledWith(
            'rebalance-p-dca',
            expect.objectContaining({ portfolioId: 'p-dca' }),
            expect.anything()
        )
    })

    it('executes normally when cross-check is disabled', async () => {
        mocks.checkRebalanceNeeded.mockResolvedValue(false)

        const summary = await processAutoRebalanceJob(mockJob())

        expect(summary.portfoliosTriggered).toBe(1)
        expect(mocks.queueAdd).toHaveBeenCalled()
    })
})

describe('isRiskPaused', () => {
    it('returns true when riskPausedUntil is in the future', () => {
        const p = { riskPausedUntil: new Date(Date.now() + 3_600_000).toISOString() } as Portfolio
        expect(isRiskPaused(p)).toBe(true)
    })

    it('returns false when riskPausedUntil is absent', () => {
        expect(isRiskPaused({} as Portfolio)).toBe(false)
    })

    it('returns false when riskPausedUntil has already elapsed', () => {
        const p = { riskPausedUntil: new Date(Date.now() - 3_600_000).toISOString() } as Portfolio
        expect(isRiskPaused(p)).toBe(false)
    })

    it('returns false when riskPausedUntil is not a valid date', () => {
        const p = { riskPausedUntil: 'not-a-date' } as Portfolio
        expect(isRiskPaused(p)).toBe(false)
    })
})