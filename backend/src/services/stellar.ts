import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { trace } from '@opentelemetry/api'

function getTracer() {
  return trace.getTracer('stellar-service', '1.0.0')
}

export interface ExecuteRebalanceOptions {
    simulateOnly?: boolean
    ignoreSafetyChecks?: boolean
    tradeSlippageOverrides?: Record<string, number>
}

export interface RebalanceDryRunResult {
    portfolioId: string
    canExecute: boolean
    overallStatus: string
    trigger: string
    estimatedTrades: any[]
    skippedTrades: any[]
    skippedAssets: any[]
    guardrails: {
        riskManagement: { allowed: boolean; reason: string }
        cooldown: { allowed: boolean; reason: string }
        marketConditions: { allowed: boolean; reason: string }
        rebalanceRequired: { allowed: boolean; reason: string }
    }
    feeEstimate: { totalFeeXlm: number; totalFeeUsd: number; xlmPriceUsd: number }
    estimatedTotalSlippageBps: number
}

export class StellarService {
    private db: Database.Database

    constructor() {
        const dbPath = process.env.DB_PATH || './data/portfolio.db'
        this.db = new Database(dbPath)
    }

    async getPortfolio(portfolioId: string): Promise<any> {
        const span = getTracer().startSpan('stellar.getPortfolio')
        span.setAttribute('portfolio.id', portfolioId)
        try {
            const row = this.db.prepare('SELECT * FROM portfolios WHERE id = ?').get(portfolioId) as any
            if (!row) {
                span.setAttribute('portfolio.found', false)
                return null
            }
            span.setAttribute('portfolio.found', true)
            return {
                id: row.id,
                userAddress: row.user_address,
                allocations: JSON.parse(row.allocations || '{}'),
                threshold: row.threshold,
                slippageTolerancePercent: row.slippage_tolerance_percent,
                balances: JSON.parse(row.balances || '{}'),
                totalValue: row.total_value,
                createdAt: row.created_at,
                lastRebalance: row.last_rebalance,
                version: row.version,
            }
        } finally {
            span.end()
        }
    }

    async checkRebalanceNeeded(portfolioId: string): Promise<boolean> {
        const span = getTracer().startSpan('stellar.checkRebalanceNeeded')
        span.setAttribute('portfolio.id', portfolioId)
        try {
            return true
        } finally {
            span.end()
        }
    }

    async executeRebalance(portfolioId: string, options?: ExecuteRebalanceOptions): Promise<any> {
        const span = getTracer().startSpan('stellar.executeRebalance')
        span.setAttribute('portfolio.id', portfolioId)
        if (options) {
            span.setAttribute('rebalance.simulate_only', options.simulateOnly || false)
            span.setAttribute('rebalance.ignore_safety_checks', options.ignoreSafetyChecks || false)
        }
        try {
            return {
                trades: 0,
                gasUsed: '0 XLM',
                timestamp: new Date().toISOString(),
                status: 'success',
                newBalances: {},
            }
        } finally {
            span.end()
        }
    }

    async dryRunRebalance(portfolioId: string, options?: ExecuteRebalanceOptions): Promise<RebalanceDryRunResult> {
        const span = getTracer().startSpan('stellar.dryRunRebalance')
        span.setAttribute('portfolio.id', portfolioId)
        try {
            return {
                portfolioId,
                canExecute: true,
                overallStatus: 'ready',
                trigger: 'Threshold exceeded',
                estimatedTrades: [],
                skippedTrades: [],
                skippedAssets: [],
                guardrails: {
                    riskManagement: { allowed: true, reason: 'OK' },
                    cooldown: { allowed: true, reason: 'OK' },
                    marketConditions: { allowed: true, reason: 'OK' },
                    rebalanceRequired: { allowed: true, reason: 'OK' },
                },
                feeEstimate: { totalFeeXlm: 0, totalFeeUsd: 0, xlmPriceUsd: 0.35 },
                estimatedTotalSlippageBps: 0,
            }
        } finally {
            span.end()
        }
    }

    async createPortfolio(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number,
        slippageTolerancePercent: number,
        strategy: string,
        strategyConfig: Record<string, unknown>,
        name?: string,
        description?: string,
    ): Promise<string> {
        const span = getTracer().startSpan('stellar.createPortfolio')
        span.setAttribute('user.address', userAddress)
        span.setAttribute('portfolio.threshold', threshold)
        span.setAttribute('portfolio.strategy', strategy)
        try {
            const id = randomUUID()
            const now = new Date().toISOString()
            this.db.prepare(`
                INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, name, description)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)
            `).run(id, userAddress, JSON.stringify(allocations), threshold, slippageTolerancePercent, '{}', now, now, name ?? null, description ?? null)
            span.setAttribute('portfolio.id', id)
            return id
        } finally {
            span.end()
        }
    }

    async estimateRebalanceGas(portfolioId: string): Promise<{ estimatedGasXlm: string; estimatedGasUsd: string }> {
        const span = getTracer().startSpan('stellar.estimateRebalanceGas')
        span.setAttribute('portfolio.id', portfolioId)
        try {
            return { estimatedGasXlm: '0', estimatedGasUsd: '0' }
        } finally {
            span.end()
        }
    }
}
