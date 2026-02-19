import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RebalanceEvent } from './rebalanceHistory.js'

// ─────────────────────────────────────────────
// Types (mirrored from portfolioStorage.ts)
// ─────────────────────────────────────────────

export interface Portfolio {
    id: string
    userAddress: string
    allocations: Record<string, number>
    threshold: number
    balances: Record<string, number>
    totalValue: number
    createdAt: string
    lastRebalance: string
}

// Raw row shape as stored in SQLite
interface PortfolioRow {
    id: string
    user_address: string
    allocations: string
    threshold: number
    balances: string
    total_value: number
    created_at: string
    last_rebalance: string
}

interface RebalanceHistoryRow {
    id: string
    portfolio_id: string
    timestamp: string
    trigger: string
    trades: number
    gas_used: string
    status: string
    is_automatic: number
    risk_alerts: string | null
    error: string | null
    details: string | null
}

// ─────────────────────────────────────────────
// Schema SQL
// ─────────────────────────────────────────────

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portfolios (
    id            TEXT PRIMARY KEY,
    user_address  TEXT NOT NULL,
    allocations   TEXT NOT NULL,
    threshold     REAL NOT NULL,
    balances      TEXT NOT NULL,
    total_value   REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_rebalance TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rebalance_history (
    id            TEXT PRIMARY KEY,
    portfolio_id  TEXT NOT NULL,
    timestamp     TEXT NOT NULL,
    trigger       TEXT NOT NULL,
    trades        INTEGER NOT NULL DEFAULT 0,
    gas_used      TEXT NOT NULL,
    status        TEXT NOT NULL,
    is_automatic  INTEGER NOT NULL DEFAULT 0,
    risk_alerts   TEXT,
    error         TEXT,
    details       TEXT,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE TABLE IF NOT EXISTS price_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset       TEXT NOT NULL,
    price       REAL NOT NULL,
    change      REAL,
    source      TEXT,
    captured_at TEXT NOT NULL
);
`

// ─────────────────────────────────────────────
// Demo seed data
// ─────────────────────────────────────────────

const DEMO_PORTFOLIO_ID = 'demo-portfolio-1'

function seedDemoData(db: Database.Database): void {
    const existingDemo = db.prepare<[string], PortfolioRow>('SELECT id FROM portfolios WHERE id = ?').get(DEMO_PORTFOLIO_ID)
    if (existingDemo) return  // already seeded

    const now = new Date().toISOString()
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

    const allocations = { XLM: 40, BTC: 30, ETH: 20, USDC: 10 }
    const balances = { XLM: 11173.18, BTC: 0.02697, ETH: 0.68257, USDC: 1000 }

    db.prepare(`
        INSERT INTO portfolios (id, user_address, allocations, threshold, balances, total_value, created_at, last_rebalance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        DEMO_PORTFOLIO_ID,
        'DEMO-USER',
        JSON.stringify(allocations),
        5,
        JSON.stringify(balances),
        10000,
        now,
        now
    )

    const historyRows = [
        {
            id: 'demo-evt-1',
            portfolioId: DEMO_PORTFOLIO_ID,
            timestamp: twoHoursAgo,
            trigger: 'Threshold exceeded (8.2%)',
            trades: 3,
            gasUsed: '0.0234 XLM',
            status: 'completed',
            isAutomatic: 0,
            riskAlerts: null,
            error: null,
            details: JSON.stringify({
                fromAsset: 'XLM', toAsset: 'ETH', amount: 1200,
                reason: 'Portfolio allocation drift exceeded rebalancing threshold',
                riskLevel: 'medium', priceDirection: 'down', performanceImpact: 'neutral'
            })
        },
        {
            id: 'demo-evt-2',
            portfolioId: DEMO_PORTFOLIO_ID,
            timestamp: twelveHoursAgo,
            trigger: 'Automatic Rebalancing',
            trades: 2,
            gasUsed: '0.0156 XLM',
            status: 'completed',
            isAutomatic: 1,
            riskAlerts: null,
            error: null,
            details: JSON.stringify({
                reason: 'Automated scheduled rebalancing executed',
                riskLevel: 'low', priceDirection: 'up', performanceImpact: 'positive'
            })
        },
        {
            id: 'demo-evt-3',
            portfolioId: DEMO_PORTFOLIO_ID,
            timestamp: threeDaysAgo,
            trigger: 'Volatility circuit breaker',
            trades: 1,
            gasUsed: '0.0089 XLM',
            status: 'completed',
            isAutomatic: 1,
            riskAlerts: null,
            error: null,
            details: JSON.stringify({
                reason: 'High market volatility detected, protective rebalance executed',
                volatilityDetected: true, riskLevel: 'high', priceDirection: 'down', performanceImpact: 'negative'
            })
        }
    ]

    const insertEvent = db.prepare(`
        INSERT INTO rebalance_history
            (id, portfolio_id, timestamp, trigger, trades, gas_used, status, is_automatic, risk_alerts, error, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const ev of historyRows) {
        insertEvent.run(
            ev.id, ev.portfolioId, ev.timestamp, ev.trigger, ev.trades,
            ev.gasUsed, ev.status, ev.isAutomatic, ev.riskAlerts, ev.error, ev.details
        )
    }

    console.log('[DB] Demo data seeded (portfolio + 3 history events)')
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function rowToPortfolio(row: PortfolioRow): Portfolio {
    return {
        id: row.id,
        userAddress: row.user_address,
        allocations: JSON.parse(row.allocations),
        threshold: row.threshold,
        balances: JSON.parse(row.balances),
        totalValue: row.total_value,
        createdAt: row.created_at,
        lastRebalance: row.last_rebalance
    }
}

function rowToEvent(row: RebalanceHistoryRow): RebalanceEvent {
    return {
        id: row.id,
        portfolioId: row.portfolio_id,
        timestamp: row.timestamp,
        trigger: row.trigger,
        trades: row.trades,
        gasUsed: row.gas_used,
        status: row.status as RebalanceEvent['status'],
        isAutomatic: row.is_automatic === 1,
        riskAlerts: row.risk_alerts ? JSON.parse(row.risk_alerts) : [],
        error: row.error ?? undefined,
        details: row.details ? JSON.parse(row.details) : undefined
    }
}

function generateId(): string {
    return Date.now().toString() + Math.random().toString(36).substring(2, 9)
}

// ─────────────────────────────────────────────
// DatabaseService
// ─────────────────────────────────────────────

export class DatabaseService {
    private db: Database.Database

    constructor() {
        const dbPath = process.env.DB_PATH || './data/portfolio.db'
        mkdirSync(dirname(dbPath), { recursive: true })
        this.db = new Database(dbPath)
        this.db.exec(SCHEMA_SQL)

        // Seed demo data on first run (empty portfolios table)
        const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM portfolios').get() as { cnt: number }).cnt
        if (count === 0) {
            seedDemoData(this.db)
        }

        console.log(`[DB] SQLite database ready at: ${dbPath}`)
    }

    // ── Public accessor for backward-compat (routes use portfolioStorage.portfolios.size) ──
    get portfolios(): { size: number } {
        return { size: this.getPortfolioCount() }
    }

    // ──────────────────────────────────────────
    // Portfolio methods (PortfolioStorage parity)
    // ──────────────────────────────────────────

    createPortfolio(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number
    ): string {
        const id = generateId()
        const now = new Date().toISOString()
        this.db.prepare(`
            INSERT INTO portfolios (id, user_address, allocations, threshold, balances, total_value, created_at, last_rebalance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, userAddress, JSON.stringify(allocations), threshold, JSON.stringify({}), 0, now, now)
        return id
    }

    createPortfolioWithBalances(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number,
        currentBalances: Record<string, number>
    ): string {
        const id = generateId()
        const now = new Date().toISOString()
        const totalValue = Object.values(currentBalances).reduce((sum, bal) => sum + bal, 0)
        this.db.prepare(`
            INSERT INTO portfolios (id, user_address, allocations, threshold, balances, total_value, created_at, last_rebalance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, userAddress, JSON.stringify(allocations), threshold, JSON.stringify(currentBalances), totalValue, now, now)
        return id
    }

    getPortfolio(id: string): Portfolio | undefined {
        const row = this.db.prepare<[string], PortfolioRow>('SELECT * FROM portfolios WHERE id = ?').get(id)
        return row ? rowToPortfolio(row) : undefined
    }

    getUserPortfolios(userAddress: string): Portfolio[] {
        const rows = this.db.prepare<[string], PortfolioRow>('SELECT * FROM portfolios WHERE user_address = ?').all(userAddress)
        return rows.map(rowToPortfolio)
    }

    updatePortfolio(id: string, updates: Partial<Portfolio>): boolean {
        const row = this.db.prepare<[string], PortfolioRow>('SELECT * FROM portfolios WHERE id = ?').get(id)
        if (!row) return false

        const current = rowToPortfolio(row)
        const merged = { ...current, ...updates }

        this.db.prepare(`
            UPDATE portfolios
            SET user_address = ?, allocations = ?, threshold = ?, balances = ?,
                total_value = ?, last_rebalance = ?
            WHERE id = ?
        `).run(
            merged.userAddress,
            JSON.stringify(merged.allocations),
            merged.threshold,
            JSON.stringify(merged.balances),
            merged.totalValue,
            merged.lastRebalance,
            id
        )
        return true
    }

    getAllPortfolios(): Portfolio[] {
        const rows = this.db.prepare<[], PortfolioRow>('SELECT * FROM portfolios').all()
        return rows.map(rowToPortfolio)
    }

    getPortfolioCount(): number {
        const result = this.db.prepare('SELECT COUNT(*) as cnt FROM portfolios').get() as { cnt: number }
        return result.cnt
    }

    deletePortfolio(id: string): boolean {
        const result = this.db.prepare('DELETE FROM portfolios WHERE id = ?').run(id)
        return result.changes > 0
    }

    clearAll(): void {
        this.db.prepare('DELETE FROM rebalance_history').run()
        this.db.prepare('DELETE FROM portfolios').run()
    }

    // ──────────────────────────────────────────
    // Rebalance history methods
    // ──────────────────────────────────────────

    recordRebalanceEvent(eventData: {
        portfolioId: string
        trigger: string
        trades: number
        gasUsed: string
        status: 'completed' | 'failed' | 'pending'
        isAutomatic?: boolean
        riskAlerts?: any[]
        error?: string
        details?: any
    }): RebalanceEvent {
        const event: RebalanceEvent = {
            id: generateId(),
            portfolioId: eventData.portfolioId,
            timestamp: new Date().toISOString(),
            trigger: eventData.trigger,
            trades: eventData.trades,
            gasUsed: eventData.gasUsed,
            status: eventData.status,
            isAutomatic: eventData.isAutomatic ?? false,
            riskAlerts: eventData.riskAlerts ?? [],
            error: eventData.error,
            details: eventData.details
        }

        this.db.prepare(`
            INSERT INTO rebalance_history
                (id, portfolio_id, timestamp, trigger, trades, gas_used, status, is_automatic, risk_alerts, error, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            event.id,
            event.portfolioId,
            event.timestamp,
            event.trigger,
            event.trades,
            event.gasUsed,
            event.status,
            event.isAutomatic ? 1 : 0,
            event.riskAlerts?.length ? JSON.stringify(event.riskAlerts) : null,
            event.error ?? null,
            event.details ? JSON.stringify(event.details) : null
        )

        return event
    }

    getRebalanceHistory(portfolioId?: string, limit: number = 50): RebalanceEvent[] {
        if (portfolioId) {
            const rows = this.db.prepare<[string, number], RebalanceHistoryRow>(
                'SELECT * FROM rebalance_history WHERE portfolio_id = ? ORDER BY timestamp DESC LIMIT ?'
            ).all(portfolioId, limit)
            return rows.map(rowToEvent)
        }

        const rows = this.db.prepare<[number], RebalanceHistoryRow>(
            'SELECT * FROM rebalance_history ORDER BY timestamp DESC LIMIT ?'
        ).all(limit)
        return rows.map(rowToEvent)
    }

    getRecentAutoRebalances(portfolioId: string, limit: number = 10): RebalanceEvent[] {
        const rows = this.db.prepare<[string, number], RebalanceHistoryRow>(`
            SELECT * FROM rebalance_history
            WHERE portfolio_id = ? AND is_automatic = 1
            ORDER BY timestamp DESC LIMIT ?
        `).all(portfolioId, limit)
        return rows.map(rowToEvent)
    }

    getAutoRebalancesSince(portfolioId: string, since: Date): RebalanceEvent[] {
        const rows = this.db.prepare<[string, string], RebalanceHistoryRow>(`
            SELECT * FROM rebalance_history
            WHERE portfolio_id = ? AND is_automatic = 1 AND timestamp >= ?
            ORDER BY timestamp DESC
        `).all(portfolioId, since.toISOString())
        return rows.map(rowToEvent)
    }

    getAllAutoRebalances(): RebalanceEvent[] {
        const rows = this.db.prepare<[], RebalanceHistoryRow>(
            'SELECT * FROM rebalance_history WHERE is_automatic = 1 ORDER BY timestamp DESC'
        ).all()
        return rows.map(rowToEvent)
    }

    initializeDemoData(portfolioId: string): void {
        // Check if there's already history for this portfolio
        const existing = this.db.prepare<[string], { cnt: number }>(
            'SELECT COUNT(*) as cnt FROM rebalance_history WHERE portfolio_id = ?'
        ).get(portfolioId)
        if (existing && existing.cnt > 0) return

        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

        const demoEvents = [
            {
                id: generateId(), portfolioId,
                timestamp: twoHoursAgo, trigger: 'Threshold exceeded (8.2%)', trades: 3,
                gasUsed: '0.0234 XLM', status: 'completed', isAutomatic: 0,
                details: {
                    fromAsset: 'XLM', toAsset: 'ETH', amount: 1200,
                    reason: 'Portfolio allocation drift exceeded rebalancing threshold',
                    riskLevel: 'medium', priceDirection: 'down', performanceImpact: 'neutral'
                }
            },
            {
                id: generateId(), portfolioId,
                timestamp: twelveHoursAgo, trigger: 'Automatic Rebalancing', trades: 2,
                gasUsed: '0.0156 XLM', status: 'completed', isAutomatic: 1,
                details: {
                    reason: 'Automated scheduled rebalancing executed',
                    riskLevel: 'low', priceDirection: 'up', performanceImpact: 'positive'
                }
            },
            {
                id: generateId(), portfolioId,
                timestamp: threeDaysAgo, trigger: 'Volatility circuit breaker', trades: 1,
                gasUsed: '0.0089 XLM', status: 'completed', isAutomatic: 1,
                details: {
                    reason: 'High market volatility detected, protective rebalance executed',
                    volatilityDetected: true, riskLevel: 'high', priceDirection: 'down', performanceImpact: 'negative'
                }
            }
        ]

        const insert = this.db.prepare(`
            INSERT INTO rebalance_history
                (id, portfolio_id, timestamp, trigger, trades, gas_used, status, is_automatic, risk_alerts, error, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        for (const ev of demoEvents) {
            insert.run(
                ev.id, ev.portfolioId, ev.timestamp, ev.trigger, ev.trades,
                ev.gasUsed, ev.status, ev.isAutomatic, null, null,
                ev.details ? JSON.stringify(ev.details) : null
            )
        }
    }

    clearHistory(portfolioId?: string): void {
        if (portfolioId) {
            this.db.prepare('DELETE FROM rebalance_history WHERE portfolio_id = ?').run(portfolioId)
        } else {
            this.db.prepare('DELETE FROM rebalance_history').run()
        }
    }

    getHistoryStats(): { totalEvents: number; portfolios: number; recentActivity: number; autoRebalances: number } {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

        const total = (this.db.prepare('SELECT COUNT(*) as cnt FROM rebalance_history').get() as { cnt: number }).cnt
        const portfolios = (this.db.prepare('SELECT COUNT(DISTINCT portfolio_id) as cnt FROM rebalance_history').get() as { cnt: number }).cnt
        const recentActivity = (this.db.prepare<[string], { cnt: number }>(
            'SELECT COUNT(*) as cnt FROM rebalance_history WHERE timestamp >= ?'
        ).get(oneDayAgo) as { cnt: number }).cnt
        const autoRebalances = (this.db.prepare(
            'SELECT COUNT(*) as cnt FROM rebalance_history WHERE is_automatic = 1'
        ).get() as { cnt: number }).cnt

        return { totalEvents: total, portfolios, recentActivity, autoRebalances }
    }

    // ──────────────────────────────────────────
    // Price snapshots (optional, for future use)
    // ──────────────────────────────────────────

    savePriceSnapshot(asset: string, price: number, change?: number, source?: string): void {
        this.db.prepare(`
            INSERT INTO price_snapshots (asset, price, change, source, captured_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(asset, price, change ?? null, source ?? null, new Date().toISOString())
    }

    getLatestPriceSnapshot(asset: string): { price: number; change?: number; capturedAt: string } | undefined {
        const row = this.db.prepare<[string], { price: number; change: number | null; captured_at: string }>(
            'SELECT price, change, captured_at FROM price_snapshots WHERE asset = ? ORDER BY captured_at DESC LIMIT 1'
        ).get(asset)
        if (!row) return undefined
        return { price: row.price, change: row.change ?? undefined, capturedAt: row.captured_at }
    }

    close(): void {
        this.db.close()
    }
}

// Singleton export
export const databaseService = new DatabaseService()
