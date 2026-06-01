import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Portfolio } from '../types/index.js'

// Mock the PG client for PostgreSQL adapter testing
vi.mock('../db/client.js', () => {
    let pgState: any[] = []
    let historyState: any[] = []
    
    return {
        query: vi.fn(async (text: string, params?: any[]) => {
            if (text.includes('INSERT INTO portfolios')) {
                const [id, user_address, allocations, threshold, slippage_tolerance, balances, total_value, strategy, strategy_config] = params!
                pgState.push({
                    id,
                    user_address,
                    allocations: allocations ? JSON.parse(allocations) : {},
                    threshold,
                    slippage_tolerance: slippage_tolerance ?? 1,
                    balances: balances ? JSON.parse(balances) : {},
                    total_value: total_value ?? 0,
                    created_at: new Date(),
                    last_rebalance: new Date(),
                    version: 1,
                    strategy: strategy ?? 'threshold',
                    strategy_config: strategy_config ? JSON.parse(strategy_config) : {}
                })
                return { rowCount: 1 }
            }
            if (text.includes('SELECT * FROM portfolios WHERE id = $1')) {
                const row = pgState.find(p => p.id === params![0])
                return { rows: row ? [row] : [] }
            }
            if (text.includes('UPDATE portfolios')) {
                const id = params![params!.length - 1]
                const idx = pgState.findIndex(p => p.id === id)
                if (idx === -1) return { rowCount: 0 }
                
                if (text.includes('threshold = $')) {
                    // Find which parameter corresponds to threshold
                    const sets = text.split('SET ')[1].split(' WHERE')[0].split(', ')
                    const thresholdParamIdx = sets.findIndex(s => s.includes('threshold ='))
                    if (thresholdParamIdx !== -1) {
                        pgState[idx].threshold = params![thresholdParamIdx]
                    }
                }
                
                pgState[idx].version += 1
                return { rowCount: 1, changes: 1 }
            }
            if (text.includes('DELETE FROM portfolios')) {
                const initialLen = pgState.length
                pgState = pgState.filter(p => p.id !== params![0])
                return { rowCount: initialLen - pgState.length }
            }
            if (text.includes('INSERT INTO rebalance_events')) {
                const [id, portfolio_id, trigger, trades, gas_used, status, is_automatic, risk_alerts, error, details, timestamp] = params!
                historyState.push({
                    id,
                    portfolio_id,
                    timestamp: timestamp || new Date(),
                    trigger,
                    trades,
                    gas_used,
                    status,
                    is_automatic,
                    risk_alerts: risk_alerts ? JSON.parse(risk_alerts) : null,
                    error,
                    details: details ? JSON.parse(details) : null
                })
                return { rowCount: 1 }
            }
            if (text.includes('SELECT * FROM rebalance_events')) {
                let filtered = [...historyState]
                if (text.includes('portfolio_id = $1')) {
                    filtered = filtered.filter(h => h.portfolio_id === params![0])
                }
                filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                const limit = params![params!.length - 1]
                return { rows: filtered.slice(0, limit) }
            }
            if (text.includes('SELECT COUNT(*)')) {
                return { rows: [{ count: pgState.length.toString() }] }
            }
            return { rows: [], rowCount: 0 }
        }),
        isDbConfigured: vi.fn(() => true), // Force PG path in PortfolioStorage
        getPool: vi.fn(),
        closePool: vi.fn()
    }
})

const createTempDbPath = (): string => {
    const dir = join(tmpdir(), `adapter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'test.db')
}

describe('Storage Adapter Compatibility', () => {
    let sqliteDbPath: string
    let envBackup: NodeJS.ProcessEnv

    beforeEach(async () => {
        vi.resetModules()
        envBackup = { ...process.env }
        sqliteDbPath = createTempDbPath()
        process.env.DB_PATH = sqliteDbPath
        process.env.ENABLE_DEMO_DB_SEED = 'false'
        process.env.DATABASE_URL = 'postgres://mock' // Trigger PG paths
    })

    afterEach(() => {
        process.env = envBackup
        if (existsSync(sqliteDbPath)) {
            try {
                rmSync(sqliteDbPath, { recursive: true, force: true })
            } catch {}
        }
    })

    it('should maintain identical Portfolio object shapes between SQLite and PostgreSQL adapters', async () => {
        const { DatabaseService } = await import('../services/databaseService.js')
        const { PortfolioStorage } = await import('../services/portfolioStorage.js')
        
        const sqliteAdapter = new DatabaseService()
        const pgAdapter = new PortfolioStorage()

        const userAddress = 'G-TEST-123'
        const allocations = { XLM: 50, USDC: 50 }
        const threshold = 3
        const slippage = 1.2

        // 1. Create
        const sqliteId = sqliteAdapter.createPortfolio(userAddress, allocations, threshold, slippage)
        const pgId = await pgAdapter.createPortfolioWithBalances(userAddress, allocations, threshold, {}, slippage)

        // 2. Read
        const sqlitePortfolio = sqliteAdapter.getPortfolio(sqliteId)
        const pgPortfolio = await pgAdapter.getPortfolio(pgId)

        expect(sqlitePortfolio).toBeDefined()
        expect(pgPortfolio).toBeDefined()

        // Check essential fields
        const compare = (p1: any, p2: any) => {
            expect(p1.userAddress).toBe(p2.userAddress)
            expect(p1.allocations).toEqual(p2.allocations)
            expect(p1.threshold).toBe(p2.threshold)
            expect(p1.slippageTolerance).toBe(p2.slippageTolerance)
            expect(p1.version).toBe(p2.version)
        }

        compare(sqlitePortfolio, pgPortfolio)

        // 3. Update
        const updates = { threshold: 4, totalValue: 100 }
        sqliteAdapter.updatePortfolio(sqliteId, updates)
        await pgAdapter.updatePortfolio(pgId, updates)

        const sqliteUpdated = sqliteAdapter.getPortfolio(sqliteId)
        const pgUpdated = await pgAdapter.getPortfolio(pgId)

        compare(sqliteUpdated, pgUpdated)
        expect(sqliteUpdated?.threshold).toBe(4)
        expect(pgUpdated?.threshold).toBe(4)

        // 4. Delete
        const sqliteDeleted = sqliteAdapter.deletePortfolio(sqliteId)
        const pgDeleted = await pgAdapter.deletePortfolio(pgId)

        expect(sqliteDeleted).toBe(true)
        expect(pgDeleted).toBe(true)
        expect(sqliteAdapter.getPortfolio(sqliteId)).toBeUndefined()
        expect(await pgAdapter.getPortfolio(pgId)).toBeUndefined()
        
        sqliteAdapter.close()
    })

    it('should have consistent pagination behavior for rebalance history', async () => {
        const { DatabaseService } = await import('../services/databaseService.js')
        const rebalanceHistoryDb = await import('../db/rebalanceHistoryDb.js')
        
        const sqliteAdapter = new DatabaseService()
        const portfolioId = 'p-123'
        const userAddress = 'G-HISTORY-USER'
        
        // Ensure portfolio exists for both adapters
        const sqliteId = sqliteAdapter.createPortfolio(userAddress, { XLM: 100 }, 5)
        const { query } = await import('../db/client.js')
        const pgId = 'pg-p-123'
        await query('INSERT INTO portfolios (id, user_address, allocations, threshold, balances, total_value) VALUES ($1, $2, $3, $4, $5, $6)', [pgId, userAddress, JSON.stringify({XLM: 100}), 5, JSON.stringify({}), 0])

        // Record 5 events in both
        for (let i = 1; i <= 5; i++) {
            const timestamp = new Date(Date.now() + i * 1000).toISOString()
            sqliteAdapter.recordRebalanceEvent({
                portfolioId: sqliteId,
                trigger: `Test ${i}`,
                trades: i,
                gasUsed: '0.01 XLM',
                status: 'completed',
                isAutomatic: true,
                timestamp
            })
            await rebalanceHistoryDb.dbInsertRebalanceEvent({
                id: `pg-ev-${i}`,
                portfolioId: pgId,
                trigger: `Test ${i}`,
                trades: i,
                gasUsed: '0.01 XLM',
                status: 'completed',
                isAutomatic: true,
                timestamp: new Date(timestamp)
            })
        }

        // Test limit 2
        const sqliteHistory = sqliteAdapter.getRebalanceHistory(sqliteId, 2)
        const pgHistory = await rebalanceHistoryDb.dbGetRebalanceHistoryByPortfolio(pgId, 2)

        expect(sqliteHistory).toHaveLength(2)
        expect(pgHistory).toHaveLength(2)
        
        // Ensure newest first (consistent ordering)
        expect(sqliteHistory[0].trades).toBe(5)
        expect(pgHistory[0].trades).toBe(5)

        sqliteAdapter.close()
    })

    it('should not let ENABLE_DEMO_DB_SEED pollute test data when disabled', async () => {
        process.env.ENABLE_DEMO_DB_SEED = 'false'
        const { DatabaseService } = await import('../services/databaseService.js')
        const sqliteAdapter = new DatabaseService()
        
        try {
            expect(sqliteAdapter.getPortfolioCount()).toBe(0)
        } finally {
            sqliteAdapter.close()
        }
    })
})
