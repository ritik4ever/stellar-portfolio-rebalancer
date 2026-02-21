import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseService } from '../services/databaseService.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTempDb(): { service: DatabaseService; dbPath: string } {
    const dir = join(tmpdir(), `stellar-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    const dbPath = join(dir, 'test.db')
    process.env.DB_PATH = dbPath
    const service = new DatabaseService()
    return { service, dbPath }
}

// ─── Portfolio CRUD ──────────────────────────────────────────────────────────

describe('DatabaseService – portfolios', () => {
    let db: DatabaseService
    let dbPath: string

    beforeEach(() => {
        const result = makeTempDb()
        db = result.service
        dbPath = result.dbPath
    })

    afterEach(() => {
        db.close()
        // Remove temp db file
        if (existsSync(dbPath)) rmSync(dbPath, { force: true })
        delete process.env.DB_PATH
    })

    it('creates a portfolio and reads it back', () => {
        const id = db.createPortfolio('GABC123', { XLM: 60, USDC: 40 }, 5)
        expect(id).toBeTruthy()

        const portfolio = db.getPortfolio(id)
        expect(portfolio).toBeDefined()
        expect(portfolio!.userAddress).toBe('GABC123')
        expect(portfolio!.allocations).toEqual({ XLM: 60, USDC: 40 })
        expect(portfolio!.threshold).toBe(5)
        expect(portfolio!.balances).toEqual({})
    })

    it('createPortfolioWithBalances stores balances and computes totalValue', () => {
        const balances = { XLM: 1000, USDC: 500 }
        const id = db.createPortfolioWithBalances('GXYZ456', { XLM: 60, USDC: 40 }, 10, balances)

        const portfolio = db.getPortfolio(id)
        expect(portfolio).toBeDefined()
        expect(portfolio!.balances).toEqual(balances)
        expect(portfolio!.totalValue).toBe(1500)
    })

    it('updates a portfolio and reflects changes', () => {
        const id = db.createPortfolio('GUPDATE', { XLM: 100 }, 5)
        const now = new Date().toISOString()

        const ok = db.updatePortfolio(id, {
            lastRebalance: now,
            balances: { XLM: 50000 },
            totalValue: 25000
        })
        expect(ok).toBe(true)

        const portfolio = db.getPortfolio(id)
        expect(portfolio!.lastRebalance).toBe(now)
        expect(portfolio!.balances).toEqual({ XLM: 50000 })
        expect(portfolio!.totalValue).toBe(25000)
    })

    it('returns undefined for a non-existent portfolio', () => {
        expect(db.getPortfolio('nonexistent-id')).toBeUndefined()
    })

    it('getUserPortfolios filters by user address', () => {
        db.createPortfolio('USER-A', { XLM: 100 }, 5)
        db.createPortfolio('USER-A', { BTC: 50, ETH: 50 }, 10)
        db.createPortfolio('USER-B', { USDC: 100 }, 3)

        const userAPortfolios = db.getUserPortfolios('USER-A')
        expect(userAPortfolios).toHaveLength(2)
        userAPortfolios.forEach(p => expect(p.userAddress).toBe('USER-A'))
    })

    it('getPortfolioCount returns correct count', () => {
        // Demo data is seeded on first run (1 demo portfolio)
        const initial = db.getPortfolioCount()
        db.createPortfolio('USER-COUNT', { XLM: 100 }, 5)
        expect(db.getPortfolioCount()).toBe(initial + 1)
    })

    it('deletePortfolio removes the portfolio', () => {
        const id = db.createPortfolio('USER-DEL', { XLM: 100 }, 5)
        expect(db.getPortfolio(id)).toBeDefined()

        const deleted = db.deletePortfolio(id)
        expect(deleted).toBe(true)
        expect(db.getPortfolio(id)).toBeUndefined()
    })
})

// ─── Persistence across instances ───────────────────────────────────────────

describe('DatabaseService – persistence across instances', () => {
    let dbPath: string

    afterEach(() => {
        if (existsSync(dbPath)) rmSync(dbPath, { force: true })
        delete process.env.DB_PATH
    })

    it('data persists when a new DatabaseService instance opens the same file', () => {
        const { service: db1 } = makeTempDb()
        dbPath = process.env.DB_PATH!

        const id = db1.createPortfolio('PERSIST-USER', { XLM: 50, ETH: 50 }, 7)
        db1.close()

        // Open a new instance pointing at the same file
        process.env.DB_PATH = dbPath
        const db2 = new DatabaseService()

        const portfolio = db2.getPortfolio(id)
        expect(portfolio).toBeDefined()
        expect(portfolio!.userAddress).toBe('PERSIST-USER')
        expect(portfolio!.allocations).toEqual({ XLM: 50, ETH: 50 })

        db2.close()
    })
})

// ─── Rebalance history ───────────────────────────────────────────────────────

describe('DatabaseService – rebalance history', () => {
    let db: DatabaseService
    let dbPath: string

    beforeEach(() => {
        const result = makeTempDb()
        db = result.service
        dbPath = result.dbPath
    })

    afterEach(() => {
        db.close()
        if (existsSync(dbPath)) rmSync(dbPath, { force: true })
        delete process.env.DB_PATH
    })

    it('records and retrieves a rebalance event', () => {
        const portfolioId = db.createPortfolio('GHIST', { XLM: 100 }, 5)

        const event = db.recordRebalanceEvent({
            portfolioId,
            trigger: 'Manual Rebalance',
            trades: 2,
            gasUsed: '0.01 XLM',
            status: 'completed',
            isAutomatic: false
        })

        expect(event.id).toBeTruthy()
        expect(event.trigger).toBe('Manual Rebalance')

        const history = db.getRebalanceHistory(portfolioId)
        expect(history.length).toBeGreaterThanOrEqual(1)
        expect(history[0].trigger).toBe('Manual Rebalance')
    })

    it('getHistoryStats returns correct aggregates', () => {
        const portfolioId = db.createPortfolio('GSTATS', { XLM: 100 }, 5)

        db.recordRebalanceEvent({ portfolioId, trigger: 'Auto', trades: 1, gasUsed: '0 XLM', status: 'completed', isAutomatic: true })
        db.recordRebalanceEvent({ portfolioId, trigger: 'Manual', trades: 1, gasUsed: '0 XLM', status: 'completed', isAutomatic: false })

        const stats = db.getHistoryStats()
        expect(stats.totalEvents).toBeGreaterThanOrEqual(2)
        expect(stats.autoRebalances).toBeGreaterThanOrEqual(1)
    })

    it('getRecentAutoRebalances filters only automatic events', () => {
        const portfolioId = db.createPortfolio('GAUTO', { XLM: 100 }, 5)

        db.recordRebalanceEvent({ portfolioId, trigger: 'Auto 1', trades: 1, gasUsed: '0 XLM', status: 'completed', isAutomatic: true })
        db.recordRebalanceEvent({ portfolioId, trigger: 'Manual 1', trades: 1, gasUsed: '0 XLM', status: 'completed', isAutomatic: false })
        db.recordRebalanceEvent({ portfolioId, trigger: 'Auto 2', trades: 1, gasUsed: '0 XLM', status: 'completed', isAutomatic: true })

        const autoEvents = db.getRecentAutoRebalances(portfolioId)
        expect(autoEvents.length).toBe(2)
        autoEvents.forEach(e => expect(e.isAutomatic).toBe(true))
    })

    it('limit parameter restricts history results', () => {
        const portfolioId = db.createPortfolio('GLIMIT', { XLM: 100 }, 5)

        for (let i = 0; i < 5; i++) {
            db.recordRebalanceEvent({ portfolioId, trigger: `Event ${i}`, trades: 1, gasUsed: '0 XLM', status: 'completed' })
        }

        const history = db.getRebalanceHistory(portfolioId, 3)
        expect(history.length).toBe(3)
    })

    it('stores on-chain indexed metadata and supports source/time filters', () => {
        const portfolioId = db.createPortfolio('GCHAIN', { XLM: 100 }, 5)
        const chainTimestamp = '2026-02-20T10:00:00.000Z'

        db.recordRebalanceEvent({
            portfolioId,
            timestamp: chainTimestamp,
            trigger: 'On-chain Rebalance Executed',
            trades: 1,
            gasUsed: 'on-chain',
            status: 'completed',
            eventSource: 'onchain',
            onChainConfirmed: true,
            onChainEventType: 'rebalance_executed',
            onChainLedger: 12345,
            onChainTxHash: 'tx-hash-1',
            onChainContractId: 'CCHAIN123',
            onChainPagingToken: 'cursor-1'
        })

        db.recordRebalanceEvent({
            portfolioId,
            trigger: 'Manual Rebalance',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
            eventSource: 'simulated',
            isSimulated: true
        })

        const onChainOnly = db.getRebalanceHistory(portfolioId, 20, { eventSource: 'onchain' })
        expect(onChainOnly).toHaveLength(1)
        expect(onChainOnly[0].onChainConfirmed).toBe(true)
        expect(onChainOnly[0].onChainLedger).toBe(12345)

        const timeWindow = db.getRebalanceHistory(portfolioId, 20, {
            startTimestamp: '2026-02-20T09:59:00.000Z',
            endTimestamp: '2026-02-20T10:01:00.000Z'
        })
        expect(timeWindow).toHaveLength(1)
        expect(timeWindow[0].timestamp).toBe(chainTimestamp)
    })

    it('deduplicates indexed on-chain events by paging token', () => {
        const portfolioId = db.createPortfolio('GCHAIN-DEDUP', { XLM: 100 }, 5)

        const first = db.recordRebalanceEvent({
            portfolioId,
            trigger: 'On-chain Deposit',
            trades: 0,
            gasUsed: 'on-chain',
            status: 'completed',
            eventSource: 'onchain',
            onChainConfirmed: true,
            onChainPagingToken: 'cursor-dedup-1'
        })

        const second = db.recordRebalanceEvent({
            portfolioId,
            trigger: 'On-chain Deposit',
            trades: 0,
            gasUsed: 'on-chain',
            status: 'completed',
            eventSource: 'onchain',
            onChainConfirmed: true,
            onChainPagingToken: 'cursor-dedup-1'
        })

        expect(second.id).toBe(first.id)
        const all = db.getRebalanceHistory(portfolioId, 20, { eventSource: 'onchain' })
        expect(all).toHaveLength(1)
    })
})

// ─── Demo seed ───────────────────────────────────────────────────────────────

describe('DatabaseService – demo seeding', () => {
    let dbPath: string

    afterEach(() => {
        if (existsSync(dbPath)) rmSync(dbPath, { force: true })
        delete process.env.DB_PATH
    })

    it('seeds a demo portfolio and history on first run', () => {
        const { service: db } = makeTempDb()
        dbPath = process.env.DB_PATH!

        // Demo portfolio should exist
        const count = db.getPortfolioCount()
        expect(count).toBeGreaterThanOrEqual(1)

        // Demo history should exist
        const stats = db.getHistoryStats()
        expect(stats.totalEvents).toBeGreaterThanOrEqual(1)

        db.close()
    })
})
