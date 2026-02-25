import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RebalanceEvent } from './rebalanceHistory.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import { ConflictError } from '../types/index.js'
import { logger } from '../utils/logger.js'
import type { Portfolio } from '../types/index.js'

// ─────────────────────────────────────────────
// Exported type used by rebalanceHistory.ts
// ─────────────────────────────────────────────
export interface RebalanceHistoryQueryOptions {
    isAutomatic?: boolean
    status?: 'completed' | 'failed' | 'pending'
    since?: string
    until?: string
    eventSource?: 'offchain' | 'simulated' | 'onchain'
    startTimestamp?: string
    endTimestamp?: string
}


// ─────────────────────────────────────────────
// Types (mirrored from portfolioStorage.ts)
// ─────────────────────────────────────────────
interface PortfolioRow {
    id: string
    user_address: string
    allocations: string
    threshold: number
    slippage_tolerance_percent?: number
    balances: string
    total_value: number
    created_at: string
    last_rebalance: string
    version: number
    strategy?: string
    strategy_config?: string
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
    slippage_tolerance_percent REAL NOT NULL DEFAULT 1,
    balances      TEXT NOT NULL,
    total_value   REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_rebalance TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1
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

CREATE INDEX IF NOT EXISTS idx_rebalance_history_portfolio_id
    ON rebalance_history (portfolio_id);

CREATE INDEX IF NOT EXISTS idx_rebalance_history_portfolio_id_timestamp
    ON rebalance_history (portfolio_id, timestamp);

CREATE TABLE IF NOT EXISTS price_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset       TEXT NOT NULL,
    price       REAL NOT NULL,
    change      REAL,
    source      TEXT,
    captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_store (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
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
        INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
        DEMO_PORTFOLIO_ID,
        'DEMO-USER',
        JSON.stringify(allocations),
        5,
        1,
        JSON.stringify(balances),
        10000,
        now,
        now,
        'threshold',
        '{}'
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

    logger.info('[DB] Demo data seeded (portfolio + 3 history events)')
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Safely parse a JSON string. Returns `fallback` instead of throwing
 * when the stored value is null, empty, or malformed.
 */
function safeJsonParse<T>(value: string | null | undefined, fallback: T, context: string): T {
    if (!value) return fallback
    try {
        return JSON.parse(value) as T
    } catch {
        logger.error('[DB] Failed to parse JSON', { context, value })
        return fallback
    }
}

function rowToPortfolio(row: PortfolioRow): Portfolio {
    return {
        id: row.id,
        userAddress: row.user_address,
        allocations: safeJsonParse(row.allocations, {}, `portfolio(${row.id}).allocations`),
        threshold: row.threshold,
        slippageTolerance: row.slippage_tolerance_percent ?? 1,
        balances: safeJsonParse(row.balances, {}, `portfolio(${row.id}).balances`),
        totalValue: row.total_value,
        createdAt: row.created_at,
        lastRebalance: row.last_rebalance,
        version: row.version ?? 1,
        strategy: (row.strategy as Portfolio['strategy']) || 'threshold',
        strategyConfig: row.strategy_config ? safeJsonParse(row.strategy_config, {}, `portfolio(${row.id}).strategy_config`) : undefined
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
        riskAlerts: safeJsonParse(row.risk_alerts, [], `event(${row.id}).risk_alerts`),
        error: row.error ?? undefined,
        details: safeJsonParse(row.details, undefined, `event(${row.id}).details`)
    }
}

function generateId(): string {
    return randomUUID()
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
        this._migrateSchema()

        // Seed demo data on first run (empty portfolios table)
        const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM portfolios').get() as { cnt: number }).cnt
        if (count === 0 && getFeatureFlags().enableDemoDbSeed) {
            seedDemoData(this.db)
        }

        logger.info('[DB] SQLite database ready', { dbPath })
    }

    private _migrateSchema(): void {
        const cols = this.db.prepare("PRAGMA table_info(portfolios)").all() as Array<{ name: string }>
        if (!cols.some(c => c.name === 'version')) {
            this.db.exec("ALTER TABLE portfolios ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
            logger.info('[DB] Migration: added version column to portfolios')
        }
        if (!cols.some(c => c.name === 'slippage_tolerance_percent')) {
            this.db.exec("ALTER TABLE portfolios ADD COLUMN slippage_tolerance_percent REAL NOT NULL DEFAULT 1")
            logger.info('[DB] Migration: added slippage_tolerance_percent column to portfolios')
        }
        if (!cols.some(c => c.name === 'strategy')) {
            this.db.exec("ALTER TABLE portfolios ADD COLUMN strategy TEXT NOT NULL DEFAULT 'threshold'")
            logger.info('[DB] Migration: added strategy column to portfolios')
        }
        if (!cols.some(c => c.name === 'strategy_config')) {
            this.db.exec("ALTER TABLE portfolios ADD COLUMN strategy_config TEXT DEFAULT '{}'")
            logger.info('[DB] Migration: added strategy_config column to portfolios')
        }
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
        threshold: number,
        slippageTolerancePercent: number = 1,
        strategy: string = 'threshold',
        strategyConfig: Record<string, unknown> = {}
    ): string {
        try {
            const id = generateId()
            const now = new Date().toISOString()
            this.db.prepare(`
                INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `).run(id, userAddress, JSON.stringify(allocations), threshold, slippageTolerancePercent, JSON.stringify({}), 0, now, now, strategy, JSON.stringify(strategyConfig))
            return id
        } catch (err) {
            throw new Error(`Failed to create portfolio for user '${userAddress}': ${err}`)
        }
    }

    createPortfolioWithBalances(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number,
        currentBalances: Record<string, number>,
        slippageTolerancePercent: number = 1,
        strategy: string = 'threshold',
        strategyConfig: Record<string, unknown> = {}
    ): string {
        try {
            const id = generateId()
            const now = new Date().toISOString()
            const totalValue = Object.values(currentBalances).reduce((sum, bal) => sum + bal, 0)
            this.db.prepare(`
                INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `).run(id, userAddress, JSON.stringify(allocations), threshold, slippageTolerancePercent, JSON.stringify(currentBalances), totalValue, now, now, strategy, JSON.stringify(strategyConfig))
            return id
        } catch (err) {
            throw new Error(`Failed to create portfolio with balances for user '${userAddress}': ${err}`)
        }
    }

    getPortfolio(id: string): Portfolio | undefined {
        try {
            const row = this.db.prepare<[string], PortfolioRow>('SELECT * FROM portfolios WHERE id = ?').get(id)
            return row ? rowToPortfolio(row) : undefined
        } catch (err) {
            throw new Error(`Failed to retrieve portfolio '${id}': ${err}`)
        }
    }

    getUserPortfolios(userAddress: string): Portfolio[] {
        try {
            const rows = this.db.prepare<[string], PortfolioRow>('SELECT * FROM portfolios WHERE user_address = ?').all(userAddress)
            return rows.map(rowToPortfolio)
        } catch (err) {
            throw new Error(`Failed to retrieve portfolios for user '${userAddress}': ${err}`)
        }
    }

    /**
     * Update a portfolio record.
     *
     * When `expectedVersion` is supplied the update uses compare-and-set
     * semantics: the row is only written when its stored version matches
     * `expectedVersion`, and the version counter is incremented atomically.
     * A `ConflictError` is thrown when the match fails, signalling that a
     * concurrent write has already advanced the version ahead of the caller.
     *
     * Omitting `expectedVersion` performs an unchecked update (backward
     * compatible) while still incrementing the version so that any subsequent
     * versioned callers detect the change.
     */
    updatePortfolio(id: string, updates: Partial<Portfolio>, expectedVersion?: number): boolean {
        try {
            const row = this.db.prepare<[string], PortfolioRow>('SELECT * FROM portfolios WHERE id = ?').get(id)
            if (!row) return false

            const current = rowToPortfolio(row)
            const merged = { ...current, ...updates }

            if (expectedVersion !== undefined) {
                // Compare-and-set: only update when version matches
                const result = this.db.prepare(`
                    UPDATE portfolios
                    SET user_address = ?, allocations = ?, threshold = ?, balances = ?,
                        total_value = ?, last_rebalance = ?, version = version + 1
                    WHERE id = ? AND version = ?
                `).run(
                    merged.userAddress,
                    JSON.stringify(merged.allocations),
                    merged.threshold,
                    JSON.stringify(merged.balances),
                    merged.totalValue,
                    merged.lastRebalance,
                    id,
                    expectedVersion
                )

                if (result.changes === 0) {
                    // Row exists but version didn't match — concurrent write detected
                    const currentRow = this.db.prepare<[string], { version: number }>(
                        'SELECT version FROM portfolios WHERE id = ?'
                    ).get(id)
                    throw new ConflictError(currentRow?.version ?? -1)
                }
            } else {
                // Unchecked update — still increment version for future versioned callers
                this.db.prepare(`
                    UPDATE portfolios
                    SET user_address = ?, allocations = ?, threshold = ?, balances = ?,
                        total_value = ?, last_rebalance = ?, version = version + 1
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
            }

            return true
        } catch (err) {
            if (err instanceof ConflictError) throw err
            throw new Error(`Failed to update portfolio '${id}': ${err}`)
        }
    }

    getAllPortfolios(): Portfolio[] {
        try {
            const rows = this.db.prepare<[], PortfolioRow>('SELECT * FROM portfolios').all()
            return rows.map(rowToPortfolio)
        } catch (err) {
            throw new Error(`Failed to retrieve all portfolios: ${err}`)
        }
    }

    getPortfolioCount(): number {
        try {
            const result = this.db.prepare('SELECT COUNT(*) as cnt FROM portfolios').get() as { cnt: number }
            return result.cnt
        } catch (err) {
            throw new Error(`Failed to count portfolios: ${err}`)
        }
    }

    deletePortfolio(id: string): boolean {
        try {
            const result = this.db.prepare('DELETE FROM portfolios WHERE id = ?').run(id)
            return result.changes > 0
        } catch (err) {
            throw new Error(`Failed to delete portfolio '${id}': ${err}`)
        }
    }

    clearAll(): void {
        try {
            this.db.prepare('DELETE FROM rebalance_history').run()
            this.db.prepare('DELETE FROM portfolios').run()
        } catch (err) {
            throw new Error(`Failed to clear all data: ${err}`)
        }
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
        timestamp?: string
        eventSource?: 'offchain' | 'simulated' | 'onchain'
        onChainConfirmed?: boolean
        onChainEventType?: string
        onChainTxHash?: string
        onChainLedger?: number
        onChainContractId?: string
        onChainPagingToken?: string
        isSimulated?: boolean
    }): RebalanceEvent {
        try {
            const event: RebalanceEvent = {
                id: generateId(),
                portfolioId: eventData.portfolioId,
                timestamp: eventData.timestamp ?? new Date().toISOString(),
                trigger: eventData.trigger,
                trades: eventData.trades,
                gasUsed: eventData.gasUsed,
                status: eventData.status,
                isAutomatic: eventData.isAutomatic ?? false,
                riskAlerts: eventData.riskAlerts ?? [],
                error: eventData.error,
                details: eventData.details,
                eventSource: eventData.eventSource,
                onChainConfirmed: eventData.onChainConfirmed,
                onChainEventType: eventData.onChainEventType,
                onChainTxHash: eventData.onChainTxHash,
                onChainLedger: eventData.onChainLedger,
                onChainContractId: eventData.onChainContractId,
                onChainPagingToken: eventData.onChainPagingToken,
                isSimulated: eventData.isSimulated
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
        } catch (err) {
            throw new Error(`Failed to record rebalance event for portfolio '${eventData.portfolioId}': ${err}`)
        }
    }

    getRebalanceHistory(portfolioId?: string, limit: number = 50, options?: RebalanceHistoryQueryOptions): RebalanceEvent[] {
        try {
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
        } catch (err) {
            throw new Error(`Failed to retrieve rebalance history${portfolioId ? ` for portfolio '${portfolioId}'` : ''
                }: ${err}`)
        }
    }

    getRecentAutoRebalances(portfolioId: string, limit: number = 10): RebalanceEvent[] {
        try {
            const rows = this.db.prepare<[string, number], RebalanceHistoryRow>(`
                SELECT * FROM rebalance_history
                WHERE portfolio_id = ? AND is_automatic = 1
                ORDER BY timestamp DESC LIMIT ?
            `).all(portfolioId, limit)
            return rows.map(rowToEvent)
        } catch (err) {
            throw new Error(`Failed to retrieve auto-rebalances for portfolio '${portfolioId}': ${err}`)
        }
    }

    getAutoRebalancesSince(portfolioId: string, since: Date): RebalanceEvent[] {
        try {
            const rows = this.db.prepare<[string, string], RebalanceHistoryRow>(`
                SELECT * FROM rebalance_history
                WHERE portfolio_id = ? AND is_automatic = 1 AND timestamp >= ?
                ORDER BY timestamp DESC
            `).all(portfolioId, since.toISOString())
            return rows.map(rowToEvent)
        } catch (err) {
            throw new Error(`Failed to retrieve auto-rebalances since ${since.toISOString()} for portfolio '${portfolioId}': ${err}`)
        }
    }

    getAllAutoRebalances(): RebalanceEvent[] {
        try {
            const rows = this.db.prepare<[], RebalanceHistoryRow>(
                'SELECT * FROM rebalance_history WHERE is_automatic = 1 ORDER BY timestamp DESC'
            ).all()
            return rows.map(rowToEvent)
        } catch (err) {
            throw new Error(`Failed to retrieve all auto-rebalances: ${err}`)
        }
    }

    initializeDemoData(portfolioId: string): void {
        try {
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
        } catch (err) {
            throw new Error(`Failed to initialize demo data for portfolio '${portfolioId}': ${err}`)
        }
    }

    clearHistory(portfolioId?: string): void {
        try {
            if (portfolioId) {
                this.db.prepare('DELETE FROM rebalance_history WHERE portfolio_id = ?').run(portfolioId)
            } else {
                this.db.prepare('DELETE FROM rebalance_history').run()
            }
        } catch (err) {
            throw new Error(`Failed to clear rebalance history${portfolioId ? ` for portfolio '${portfolioId}'` : ''
                }: ${err}`)
        }
    }

    getHistoryStats(): { totalEvents: number; portfolios: number; recentActivity: number; autoRebalances: number } {
        try {
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
        } catch (err) {
            throw new Error(`Failed to retrieve history stats: ${err}`)
        }
    }

    // ──────────────────────────────────────────
    // Price snapshots (optional, for future use)
    // ──────────────────────────────────────────

    savePriceSnapshot(asset: string, price: number, change?: number, source?: string): void {
        try {
            this.db.prepare(`
                INSERT INTO price_snapshots (asset, price, change, source, captured_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(asset, price, change ?? null, source ?? null, new Date().toISOString())
        } catch (err) {
            throw new Error(`Failed to save price snapshot for asset '${asset}': ${err}`)
        }
    }

    getLatestPriceSnapshot(asset: string): { price: number; change?: number; capturedAt: string } | undefined {
        try {
            const row = this.db.prepare<[string], { price: number; change: number | null; captured_at: string }>(
                'SELECT price, change, captured_at FROM price_snapshots WHERE asset = ? ORDER BY captured_at DESC LIMIT 1'
            ).get(asset)
            if (!row) return undefined
            return { price: row.price, change: row.change ?? undefined, capturedAt: row.captured_at }
        } catch (err) {
            throw new Error(`Failed to retrieve price snapshot for asset '${asset}': ${err}`)
        }
    }

    close(): void {
        this.db.close()
    }

    // ──────────────────────────────────────────
    // Indexer state (key-value store for contract event indexer)
    // ──────────────────────────────────────────

    getIndexerState(key: string): string | undefined {
        try {
            const row = this.db.prepare<[string], { value: string }>(
                'SELECT value FROM kv_store WHERE key = ?'
            ).get(key)
            return row?.value
        } catch {
            return undefined
        }
    }

    setIndexerState(key: string, value: string): void {
        try {
            this.db.prepare(
                'INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
            ).run(key, value)
        } catch (err) {
            throw new Error(`Failed to set indexer state key '${key}': ${err}`)
        }
    }

    ensurePortfolioExists(portfolioId: string, userAddress: string): void {
        try {
            const existing = this.getPortfolio(portfolioId)
            if (!existing) {
                this.db.prepare(`
                    INSERT OR IGNORE INTO portfolios
                        (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                `).run(
                    portfolioId, userAddress,
                    JSON.stringify({}), 5, 1,
                    JSON.stringify({}), 0,
                    new Date().toISOString(), new Date().toISOString(),
                    'threshold', '{}'
                )
            }
        } catch (err) {
            throw new Error(`Failed to ensure portfolio '${portfolioId}' exists: ${err}`)
        }
    }
}

// Singleton export
export const databaseService = new DatabaseService()
