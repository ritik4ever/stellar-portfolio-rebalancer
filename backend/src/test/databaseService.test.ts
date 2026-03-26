import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const createTempDbPath = (): string => {
    const dir = join(tmpdir(), `db-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'portfolio.db')
}

describe('DatabaseService', () => {
    let dbPath: string
    let envBackup: NodeJS.ProcessEnv

    beforeEach(() => {
        vi.resetModules()
        envBackup = { ...process.env }
        dbPath = createTempDbPath()
        process.env.DB_PATH = dbPath
        process.env.ENABLE_DEMO_DB_SEED = 'false'
        process.env.DEMO_MODE = 'false'
    })

    afterEach(() => {
        process.env = envBackup
        if (existsSync(dbPath)) {
            rmSync(dbPath, { force: true })
        }
    })

    it('creates and retrieves a portfolio with slippage tolerance', async () => {
        const { DatabaseService } = await import('../services/databaseService.js')
        const db = new DatabaseService()

        const id = db.createPortfolio('GUSER1', { XLM: 70, USDC: 30 }, 5, 1.5)
        const portfolio = db.getPortfolio(id)

        expect(portfolio).toBeDefined()
        expect(portfolio?.userAddress).toBe('GUSER1')
        expect(portfolio?.allocations).toEqual({ XLM: 70, USDC: 30 })
        expect(portfolio?.threshold).toBe(5)
        expect((portfolio as any)?.slippageTolerance).toBe(1.5)

        db.close()
    })

    it('updates portfolio with optimistic locking and increments version', async () => {
        const { DatabaseService } = await import('../services/databaseService.js')
        const { ConflictError } = await import('../types/index.js')
        const db = new DatabaseService()

        const id = db.createPortfolio('GUSER2', { XLM: 100 }, 5)
        const initial = db.getPortfolio(id)
        expect(initial?.version).toBe(1)

        const updated = db.updatePortfolio(
            id,
            { threshold: 6, totalValue: 1234, balances: { XLM: 1234 }, lastRebalance: new Date().toISOString() },
            1
        )
        expect(updated).toBe(true)

        const after = db.getPortfolio(id)
        expect(after?.threshold).toBe(6)
        expect(after?.version).toBe(2)

        expect(() => {
            db.updatePortfolio(id, { threshold: 7 }, 1)
        }).toThrow(ConflictError)

        db.close()
    })

    it('records rebalance events and returns filtered auto-rebalances', async () => {
        const { DatabaseService } = await import('../services/databaseService.js')
        const db = new DatabaseService()

        const id = db.createPortfolio('GUSER3', { XLM: 100 }, 5)
        db.recordRebalanceEvent({
            portfolioId: id,
            trigger: 'Manual Rebalance',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
            isAutomatic: false,
            details: { reason: 'manual' }
        })
        db.recordRebalanceEvent({
            portfolioId: id,
            trigger: 'Automatic Rebalancing',
            trades: 2,
            gasUsed: '0.02 XLM',
            status: 'completed',
            isAutomatic: true,
            details: { reason: 'scheduled' }
        })

        const fullHistory = db.getRebalanceHistory(id, 10)
        const autos = db.getRecentAutoRebalances(id, 10)
        const since = db.getAutoRebalancesSince(id, new Date(Date.now() - 60 * 1000))

        expect(fullHistory).toHaveLength(2)
        expect(autos).toHaveLength(1)
        expect(autos[0].isAutomatic).toBe(true)
        expect(since.length).toBeGreaterThanOrEqual(1)

        db.close()
    })

    it('stores and reads indexer state key-value entries', async () => {
        const { DatabaseService } = await import('../services/databaseService.js')
        const db = new DatabaseService()

        expect(db.getIndexerState('cursor')).toBeUndefined()
        db.setIndexerState('cursor', 'abc123')
        expect(db.getIndexerState('cursor')).toBe('abc123')
        db.setIndexerState('cursor', 'def456')
        expect(db.getIndexerState('cursor')).toBe('def456')

        db.close()
    })

    it('ensures portfolio exists without duplicating existing one', async () => {
        const { DatabaseService } = await import('../services/databaseService.js')
        const db = new DatabaseService()

        db.ensurePortfolioExists('fixed-id', 'GUSER4')
        db.ensurePortfolioExists('fixed-id', 'GUSER4')

        const all = db.getAllPortfolios().filter((p) => p.id === 'fixed-id')
        expect(all).toHaveLength(1)

        db.close()
    })

    it('seeds demo data when enabled', async () => {
        process.env.ENABLE_DEMO_DB_SEED = 'true'
        process.env.DEMO_MODE = 'true'

        const { DatabaseService } = await import('../services/databaseService.js')
        const db = new DatabaseService()

        expect(db.getPortfolioCount()).toBeGreaterThan(0)
        const stats = db.getHistoryStats()
        expect(stats.totalEvents).toBeGreaterThan(0)

        db.close()
    })
})
