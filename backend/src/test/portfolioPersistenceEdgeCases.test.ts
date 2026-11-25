/**
 * SPR-2026-160 — Portfolio persistence edge cases
 *
 * Two deterministic scenarios:
 *
 * 1. Allocation edit during an active rebalance
 *    A user edits allocations while a rebalance is in flight.  The edit
 *    carries the version number the user read before the rebalance started.
 *    The rebalance has already committed a version bump, so the edit targets
 *    a stale version.  Expected outcome:
 *      - updatePortfolio throws ConflictError
 *      - The committed portfolio version is the one written by the rebalance
 *        (not the user edit)
 *      - No duplicate rebalance history event is written
 *      - The in-flight rebalance event is the only event that exists
 *
 * 2. Database write failure after a state transition
 *    A portfolio update (state transition) succeeds but the subsequent
 *    rebalance-history insert fails.  Expected outcome:
 *      - recordRebalanceEvent propagates the error to the caller
 *      - The portfolio state (version, lastRebalance) reflects exactly the
 *        update that succeeded — no phantom increment from a retry
 *      - No rebalance event row appears (insert never completed)
 *      - The DB insert function is called exactly once (no hidden retries)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Portfolio } from '../types/index.js'
import { ConflictError } from '../types/index.js'

// ─── DB-layer doubles ──────────────────────────────────────────────────────────
// We mock both the PG rebalance-history DB module and the portfolioDb module so
// these tests run without any real database connection.

const mockDbInsertRebalanceEvent = vi.fn()
const mockDbGetRebalanceHistoryByPortfolio = vi.fn()

vi.mock('../db/rebalanceHistoryDb.js', () => ({
    dbInsertRebalanceEvent: (...args: unknown[]) => mockDbInsertRebalanceEvent(...args),
    dbGetRebalanceHistoryByPortfolio: (...args: unknown[]) => mockDbGetRebalanceHistoryByPortfolio(...args),
    dbGetRebalanceHistoryAll: vi.fn().mockResolvedValue([]),
    dbGetRecentAutoRebalances: vi.fn().mockResolvedValue([]),
    dbGetAutoRebalancesSince: vi.fn().mockResolvedValue([]),
    dbGetAllAutoRebalances: vi.fn().mockResolvedValue([]),
    dbGetHistoryStats: vi.fn().mockResolvedValue({ totalEvents: 0, portfolios: 0, recentActivity: 0, autoRebalances: 0 }),
    dbGetRebalanceHistoryCountByPortfolio: vi.fn().mockResolvedValue(0),
    dbGetRebalanceCostSummary: vi.fn().mockResolvedValue({ total_fees_paid: 0, avg_slippage_bps: 0, cost_per_rebalance: 0, total_rebalances: 0 }),
}))

vi.mock('../db/portfolioDb.js', () => ({
    dbGetPortfolio: vi.fn(),
    dbUpdatePortfolio: vi.fn(),
    dbCreatePortfolio: vi.fn(),
    dbGetAllPortfolios: vi.fn().mockResolvedValue([]),
    dbGetUserPortfolios: vi.fn().mockResolvedValue([]),
    dbDeletePortfolio: vi.fn(),
    dbArchivePortfolio: vi.fn(),
    dbRestorePortfolio: vi.fn(),
    dbSearchPortfolios: vi.fn().mockResolvedValue([]),
}))

// PG pool is never needed — short-circuit isDbConfigured() to false so
// PortfolioStorage falls back to its in-memory Map for all operations.
vi.mock('../db/client.js', () => ({
    isDbConfigured: vi.fn().mockReturnValue(false),
    query: vi.fn(),
    getPool: vi.fn(),
    closePool: vi.fn(),
}))

vi.mock('../config/featureFlags.js', () => ({
    getFeatureFlags: vi.fn().mockReturnValue({ demoMode: false }),
}))

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePortfolio(overrides: Partial<Portfolio> = {}): Portfolio {
    return {
        id: 'portfolio-test-001',
        userAddress: 'GABC1234',
        allocations: { XLM: 60, USDC: 40 },
        threshold: 5,
        balances: { XLM: 6000, USDC: 4000 },
        totalValue: 10000,
        createdAt: new Date().toISOString(),
        lastRebalance: new Date().toISOString(),
        version: 1,
        ...overrides,
    }
}

/** Minimal risk-service double required by RebalanceHistoryService constructor. */
const mockRiskService = {
    analyzePortfolioRisk: vi.fn().mockReturnValue({ overallRiskLevel: 'low' }),
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Allocation edit during active rebalance
// ─────────────────────────────────────────────────────────────────────────────

describe('SPR-2026-160 Scenario 1 — Allocation edit during active rebalance', () => {
    // Use isolated PortfolioStorage instances (in-memory, no DB) so we can
    // seed the Map directly and verify the version after each operation.
    let storage: import('../services/portfolioStorage.js').PortfolioStorage

    beforeEach(async () => {
        vi.clearAllMocks()
        // Fresh PortfolioStorage per test — avoids cross-test Map bleed
        const { PortfolioStorage } = await import('../services/portfolioStorage.js')
        storage = new PortfolioStorage()
    })

    afterEach(() => {
        storage.clearAll()
    })

    it('rebalance commits version 2; concurrent stale edit (v1) raises ConflictError', async () => {
        // Seed a portfolio at version 1 directly in the in-memory map
        const portfolio = makePortfolio({ version: 1 })
        storage.portfolios.set(portfolio.id, portfolio)

        // ── Step A: rebalance updates lastRebalance, bumping to version 2 ──
        const rebalanceUpdated = await storage.updatePortfolio(
            portfolio.id,
            { lastRebalance: new Date().toISOString() },
            /* expectedVersion */ 1,
        )
        expect(rebalanceUpdated).toBe(true)

        const afterRebalance = await storage.getPortfolio(portfolio.id)
        expect(afterRebalance?.version).toBe(2)

        // ── Step B: user edit still carries the pre-rebalance expectedVersion=1 ──
        await expect(
            storage.updatePortfolio(
                portfolio.id,
                { allocations: { XLM: 50, USDC: 50 } },
                /* expectedVersion */ 1,   // stale — rebalance already committed v2
            ),
        ).rejects.toThrow(ConflictError)

        // Version stays at 2 (the rebalance commit) — edit must not have applied
        const final = await storage.getPortfolio(portfolio.id)
        expect(final?.version).toBe(2)
        expect(final?.allocations).toEqual({ XLM: 60, USDC: 40 }) // original, not the stale edit
    })

    it('ConflictError carries the current committed version so callers can retry', async () => {
        const portfolio = makePortfolio({ version: 3 })
        storage.portfolios.set(portfolio.id, portfolio)

        let caughtError: ConflictError | undefined
        try {
            await storage.updatePortfolio(
                portfolio.id,
                { threshold: 10 },
                /* expectedVersion */ 1,  // stale by two versions
            )
        } catch (err) {
            if (err instanceof ConflictError) caughtError = err
        }

        expect(caughtError).toBeInstanceOf(ConflictError)
        // currentVersion exposes the version to retry against
        expect(caughtError?.currentVersion).toBe(3)
    })

    it('no duplicate rebalance history event when edit conflict aborts mid-rebalance', async () => {
        // Simulate a rebalance that records its event successfully
        const portfolio = makePortfolio({ version: 1 })
        storage.portfolios.set(portfolio.id, portfolio)

        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        const historyService = new RebalanceHistoryService(mockRiskService as any)

        // Rebalance completes — records one history event
        const insertedId = 'event-rebalance-001'
        mockDbInsertRebalanceEvent.mockResolvedValueOnce({ id: insertedId })

        await storage.updatePortfolio(portfolio.id, { lastRebalance: new Date().toISOString() }, 1)
        const event = await historyService.recordRebalanceEvent({
            portfolioId: portfolio.id,
            trigger: 'Threshold exceeded (8%)',
            trades: 2,
            gasUsed: '0.02 XLM',
            status: 'completed',
            isAutomatic: true,
        })

        expect(event.id).toBe(insertedId)
        expect(mockDbInsertRebalanceEvent).toHaveBeenCalledTimes(1)

        // Concurrent edit conflict — no second history write should occur
        await expect(
            storage.updatePortfolio(portfolio.id, { allocations: { XLM: 50, USDC: 50 } }, 1),
        ).rejects.toThrow(ConflictError)

        // Still exactly one insert — no duplicate side effect
        expect(mockDbInsertRebalanceEvent).toHaveBeenCalledTimes(1)

        // Confirm the single event is the one written by the rebalance
        expect(mockDbInsertRebalanceEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                portfolioId: portfolio.id,
                trigger: 'Threshold exceeded (8%)',
                status: 'completed',
                isAutomatic: true,
            }),
        )
    })

    it('successful allocation edit after rebalance completes increments version once more', async () => {
        const portfolio = makePortfolio({ version: 1 })
        storage.portfolios.set(portfolio.id, portfolio)

        // Rebalance bumps to v2
        await storage.updatePortfolio(portfolio.id, { lastRebalance: new Date().toISOString() }, 1)

        // User reads portfolio (now v2) and edits with the fresh version
        const current = await storage.getPortfolio(portfolio.id)
        expect(current?.version).toBe(2)

        const editApplied = await storage.updatePortfolio(
            portfolio.id,
            { allocations: { XLM: 50, USDC: 50 } },
            /* expectedVersion */ 2,
        )

        expect(editApplied).toBe(true)
        const afterEdit = await storage.getPortfolio(portfolio.id)
        expect(afterEdit?.version).toBe(3)
        expect(afterEdit?.allocations).toEqual({ XLM: 50, USDC: 50 })
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Database write failure after a state transition
// ─────────────────────────────────────────────────────────────────────────────

describe('SPR-2026-160 Scenario 2 — DB write failure after a state transition', () => {
    let storage: import('../services/portfolioStorage.js').PortfolioStorage
    let historyService: import('../services/rebalanceHistory.js').RebalanceHistoryService

    beforeEach(async () => {
        vi.clearAllMocks()
        const { PortfolioStorage } = await import('../services/portfolioStorage.js')
        storage = new PortfolioStorage()

        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        historyService = new RebalanceHistoryService(mockRiskService as any)
    })

    afterEach(() => {
        storage.clearAll()
    })

    it('portfolio version reflects the state transition even when history write fails', async () => {
        const portfolio = makePortfolio({ version: 1 })
        storage.portfolios.set(portfolio.id, portfolio)

        // ── Step A: state transition (rebalance completes) commits successfully ──
        const transitionAt = new Date().toISOString()
        const transitionOk = await storage.updatePortfolio(
            portfolio.id,
            { lastRebalance: transitionAt },
            /* expectedVersion */ 1,
        )
        expect(transitionOk).toBe(true)

        const afterTransition = await storage.getPortfolio(portfolio.id)
        expect(afterTransition?.version).toBe(2)
        expect(afterTransition?.lastRebalance).toBe(transitionAt)

        // ── Step B: history insert fails (simulates DB write error post-transition) ──
        const dbError = new Error('DB write failed: connection timeout')
        mockDbInsertRebalanceEvent.mockRejectedValueOnce(dbError)

        await expect(
            historyService.recordRebalanceEvent({
                portfolioId: portfolio.id,
                trigger: 'Automatic Rebalancing',
                trades: 3,
                gasUsed: '0.03 XLM',
                status: 'completed',
                isAutomatic: true,
            }),
        ).rejects.toThrow('DB write failed: connection timeout')

        // ── Assertion: portfolio state unchanged by the failed history write ──
        const final = await storage.getPortfolio(portfolio.id)
        expect(final?.version).toBe(2)        // stays at 2 — exactly the transition
        expect(final?.lastRebalance).toBe(transitionAt)
    })

    it('dbInsertRebalanceEvent is called exactly once — no silent retry on failure', async () => {
        const portfolio = makePortfolio({ version: 1 })
        storage.portfolios.set(portfolio.id, portfolio)

        mockDbInsertRebalanceEvent.mockRejectedValueOnce(
            new Error('FATAL: disk full'),
        )

        await expect(
            historyService.recordRebalanceEvent({
                portfolioId: portfolio.id,
                trigger: 'Manual Rebalancing',
                trades: 1,
                gasUsed: '0.01 XLM',
                status: 'failed',
                isAutomatic: false,
                error: 'Slippage exceeded tolerance',
            }),
        ).rejects.toThrow()

        // Exactly one attempt — the service must not retry silently
        expect(mockDbInsertRebalanceEvent).toHaveBeenCalledTimes(1)
    })

    it('no event exists in history after a failed insert', async () => {
        const portfolio = makePortfolio({ version: 1 })
        storage.portfolios.set(portfolio.id, portfolio)

        // History DB always fails for this test
        mockDbInsertRebalanceEvent.mockRejectedValue(
            new Error('FATAL: tablespace unavailable'),
        )
        mockDbGetRebalanceHistoryByPortfolio.mockResolvedValue([])

        // State transition still succeeds
        await storage.updatePortfolio(portfolio.id, { lastRebalance: new Date().toISOString() }, 1)

        // History insert fails
        await expect(
            historyService.recordRebalanceEvent({
                portfolioId: portfolio.id,
                trigger: 'Scheduled Rebalancing',
                trades: 2,
                gasUsed: '0.02 XLM',
                status: 'completed',
                isAutomatic: true,
            }),
        ).rejects.toThrow()

        // A read of history returns no events — insert never completed
        const history = await historyService.getRebalanceHistory(portfolio.id, 10)
        expect(history).toHaveLength(0)
    })

    it('a failed history write after a pending→completed transition leaves portfolio at the committed version', async () => {
        /**
         * Simulate the sequence:
         *   1. Rebalance starts  → portfolio at version 1 (pending)
         *   2. Rebalance finishes→ updatePortfolio commits lastRebalance (version 2 = "completed" state)
         *   3. recordRebalanceEvent fails to write to DB
         * Expected: portfolio stays at version 2; no phantom version 3.
         */
        const portfolio = makePortfolio({ version: 1 })
        storage.portfolios.set(portfolio.id, portfolio)

        // Transition: pending → completed
        const completedAt = new Date().toISOString()
        await storage.updatePortfolio(portfolio.id, { lastRebalance: completedAt }, 1)

        // History write fails
        mockDbInsertRebalanceEvent.mockRejectedValueOnce(new Error('DB write failed'))

        await expect(
            historyService.recordRebalanceEvent({
                portfolioId: portfolio.id,
                trigger: 'Threshold exceeded (12%)',
                trades: 4,
                gasUsed: '0.04 XLM',
                status: 'completed',
                isAutomatic: true,
            }),
        ).rejects.toThrow()

        // Version is exactly 2 — the state transition committed; no extra bump from the failed event write
        const final = await storage.getPortfolio(portfolio.id)
        expect(final?.version).toBe(2)
        expect(final?.lastRebalance).toBe(completedAt)
    })

    it('a successful retry after a transient DB failure records exactly one event', async () => {
        const portfolio = makePortfolio({ version: 1 })
        storage.portfolios.set(portfolio.id, portfolio)

        const eventId = 'event-retry-success-001'
        // First call fails, second succeeds
        mockDbInsertRebalanceEvent
            .mockRejectedValueOnce(new Error('DB write failed: transient'))
            .mockResolvedValueOnce({ id: eventId })

        // First attempt — fails
        await expect(
            historyService.recordRebalanceEvent({
                portfolioId: portfolio.id,
                trigger: 'Threshold exceeded (6%)',
                trades: 1,
                gasUsed: '0.01 XLM',
                status: 'completed',
            }),
        ).rejects.toThrow('DB write failed: transient')

        // Caller retries once — succeeds
        const event = await historyService.recordRebalanceEvent({
            portfolioId: portfolio.id,
            trigger: 'Threshold exceeded (6%)',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
        })

        expect(event.id).toBe(eventId)
        // Two total insert attempts (one fail + one success)
        expect(mockDbInsertRebalanceEvent).toHaveBeenCalledTimes(2)
    })
})
