import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseService } from '../services/databaseService.js'
import { ConflictError } from '../types/index.js'

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

// ─── Portfolio ID consistency ────────────────────────────────────────────────

describe('DatabaseService – portfolio ID consistency', () => {
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

    it('returned ID matches the ID stored in the database', () => {
        const id = db.createPortfolio('GCONS1', { XLM: 100 }, 5)
        const stored = db.getPortfolio(id)
        expect(stored).toBeDefined()
        expect(stored!.id).toBe(id)
    })

    it('createPortfolioWithBalances returned ID matches stored ID', () => {
        const id = db.createPortfolioWithBalances('GCONS2', { XLM: 100 }, 5, { XLM: 500 })
        const stored = db.getPortfolio(id)
        expect(stored).toBeDefined()
        expect(stored!.id).toBe(id)
    })

    it('generated IDs are valid UUIDs', () => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        const id1 = db.createPortfolio('GUUID1', { XLM: 100 }, 5)
        const id2 = db.createPortfolioWithBalances('GUUID2', { XLM: 100 }, 5, { XLM: 200 })
        expect(id1).toMatch(uuidRegex)
        expect(id2).toMatch(uuidRegex)
    })

    it('parallel creates produce unique IDs without collisions', () => {
        const ids = Array.from({ length: 20 }, (_, i) =>
            db.createPortfolio(`GPAR${i}`, { XLM: 100 }, 5)
        )
        const unique = new Set(ids)
        expect(unique.size).toBe(20)
    })

    it('GET after POST always finds the portfolio', () => {
        for (let i = 0; i < 10; i++) {
            const id = db.createPortfolio(`GGET${i}`, { XLM: 100 }, 5)
            expect(db.getPortfolio(id)).toBeDefined()
        }
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
})

// ─── Optimistic concurrency control ─────────────────────────────────────────

describe('DatabaseService – optimistic concurrency control', () => {
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

    it('new portfolio starts at version 1', () => {
        const id = db.createPortfolio('GVER1', { XLM: 100 }, 5)
        const portfolio = db.getPortfolio(id)
        expect(portfolio!.version).toBe(1)
    })

    it('unchecked update increments version', () => {
        const id = db.createPortfolio('GVER2', { XLM: 100 }, 5)
        db.updatePortfolio(id, { totalValue: 999 })
        const portfolio = db.getPortfolio(id)
        expect(portfolio!.version).toBe(2)
    })

    it('versioned update succeeds when expectedVersion matches', () => {
        const id = db.createPortfolio('GVER3', { XLM: 100 }, 5)
        const before = db.getPortfolio(id)!
        expect(before.version).toBe(1)

        const ok = db.updatePortfolio(id, { totalValue: 500 }, 1)
        expect(ok).toBe(true)

        const after = db.getPortfolio(id)!
        expect(after.totalValue).toBe(500)
        expect(after.version).toBe(2)
    })

    it('versioned update throws ConflictError when version is stale', () => {
        const id = db.createPortfolio('GVER4', { XLM: 100 }, 5)

        // First writer succeeds and bumps version to 2
        db.updatePortfolio(id, { totalValue: 100 }, 1)

        // Second writer still holds version 1 — must get a ConflictError
        expect(() => db.updatePortfolio(id, { totalValue: 200 }, 1))
            .toThrowError(ConflictError)
    })

    it('ConflictError carries the current version', () => {
        const id = db.createPortfolio('GVER5', { XLM: 100 }, 5)

        // Advance to version 3 via two unchecked updates
        db.updatePortfolio(id, { totalValue: 1 })
        db.updatePortfolio(id, { totalValue: 2 })

        let caught: ConflictError | undefined
        try {
            db.updatePortfolio(id, { totalValue: 3 }, 1)
        } catch (err) {
            if (err instanceof ConflictError) caught = err
        }

        expect(caught).toBeInstanceOf(ConflictError)
        expect(caught!.currentVersion).toBe(3)
    })

    it('simulates lost-update prevention: two concurrent writers, second is rejected', () => {
        const id = db.createPortfolio('GVER6', { XLM: 100 }, 5)

        // Both readers observe version 1 at the same time
        const snapshotA = db.getPortfolio(id)!
        const snapshotB = db.getPortfolio(id)!
        expect(snapshotA.version).toBe(1)
        expect(snapshotB.version).toBe(1)

        // Writer A commits first — succeeds
        const okA = db.updatePortfolio(id, { totalValue: 111 }, snapshotA.version)
        expect(okA).toBe(true)
        expect(db.getPortfolio(id)!.version).toBe(2)

        // Writer B attempts to commit with stale version — must be rejected
        expect(() => db.updatePortfolio(id, { totalValue: 222 }, snapshotB.version))
            .toThrowError(ConflictError)

        // Final value is the one committed by writer A, not silently overwritten by B
        expect(db.getPortfolio(id)!.totalValue).toBe(111)
    })

    it('versioned update returns false when portfolio does not exist', () => {
        const ok = db.updatePortfolio('nonexistent', { totalValue: 1 }, 1)
        expect(ok).toBe(false)
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
