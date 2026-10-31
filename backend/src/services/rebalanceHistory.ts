import { RiskManagementService } from './riskManagements.js'
import { databaseService } from './databaseService.js'
import { isDbConfigured } from '../db/client.js'
import {
  dbInsertRebalanceEvent,
  dbGetRebalanceHistoryByPortfolio,
  dbGetRebalanceHistoryAll,
  dbGetRecentAutoRebalances,
  dbGetAutoRebalancesSince,
  dbGetAllAutoRebalances,
  dbGetHistoryStats,
  dbGetRebalanceHistoryCountByPortfolio,
  dbGetRebalanceCostSummary,
} from '../db/rebalanceHistoryDb.js'
import type { RebalanceCostSummary, RebalanceHistoryQueryOptions } from '../db/rebalanceHistoryDb.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import type { PricesMap } from '../types/index.js'
import { logger } from '../utils/logger.js'
<<<<<<< HEAD
import {
    bucketPortfolioId,
    recordPortfolioPersistenceOutcome,
} from '../observability/metrics.js'
import type {
    PortfolioPersistenceOutcome,
    PortfolioPersistenceSource,
    PortfolioPersistenceTransition,
} from '../observability/metrics.js'

function getSafeDatabaseErrorCode(error: unknown): string {
    if (typeof error !== 'object' || error === null || !('code' in error)) return 'unknown'
    const code = error.code
    return typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : 'unknown'
}
=======
import { randomUUID } from 'node:crypto'
>>>>>>> 8ea814a (update made)

export interface RebalanceEvent {
    id: string
    portfolioId: string
    timestamp: string
    trigger: string
    trades: number
    gasUsed: string
    feePaid?: number
    slippageBps?: number
    status: 'completed' | 'failed' | 'pending'
    isAutomatic?: boolean
    riskAlerts?: any[]
    error?: string
    actor?: 'user' | 'system' | 'admin' | 'scheduler'
    source?: 'dashboard' | 'api' | 'contract' | 'scheduler' | 'auto_rebalance'
    triggerMetadata?: Record<string, unknown>
    eventSource?: 'offchain' | 'simulated' | 'onchain'
    onChainConfirmed?: boolean
    onChainEventType?: string
    onChainTxHash?: string
    onChainLedger?: number
    onChainContractId?: string
    onChainPagingToken?: string
    isSimulated?: boolean
    details?: {
        fromAsset?: string
        toAsset?: string
        amount?: number
        reason?: string
        volatilityDetected?: boolean
        riskLevel?: 'low' | 'medium' | 'high'
        priceDirection?: 'up' | 'down'
        performanceImpact?: 'positive' | 'negative' | 'neutral'
        riskMetrics?: any
        marketConditions?: any
        estimatedSlippageBps?: number
        actualSlippageBps?: number
        slippageExceededTolerance?: boolean
        totalSlippageBps?: number
        gasFeeXlm?: number
        gasFeeUsd?: number
        gasPerTradeXlm?: number
        gasWarning?: boolean
        gasBreakdown?: Array<{ tradeId: string, fromAsset?: string, toAsset?: string, feeXlm: number }>
        feePaid?: number
        slippageBps?: number
        stateTransition?: 'committed' | 'unknown'
        eventSource?: 'offchain' | 'simulated' | 'onchain'
        actor?: 'user' | 'system' | 'admin' | 'scheduler'
        source?: 'dashboard' | 'api' | 'contract' | 'scheduler' | 'auto_rebalance'
        triggerMetadata?: Record<string, unknown>
        onChainConfirmed?: boolean
        onChainEventType?: string
        onChainTxHash?: string
        onChainLedger?: number
        onChainContractId?: string
        onChainPagingToken?: string
        isSimulated?: boolean
    }
}

export class RebalanceHistoryService {
    private riskService: RiskManagementService

    constructor(riskService?: RiskManagementService) {
        this.riskService = riskService ?? new RiskManagementService()
    }

    async recordRebalanceEvent(eventData: {
        /** Optional caller-supplied identity, used to make retries idempotent. */
        id?: string
        portfolioId: string
        trigger: string
        trades: number
        gasUsed: string
        status: 'completed' | 'failed' | 'pending'
        timestamp?: string | Date
        /** Extra persisted detail, merged over the derived analysis fields. */
        details?: Record<string, unknown>
        isAutomatic?: boolean
        riskAlerts?: any[]
        error?: string
        fromAsset?: string
        toAsset?: string
        amount?: number
        prices?: PricesMap
        /** Stored portfolio record. Must have `allocations` as a `Record<string, number>`. */
        portfolio?: { allocations: Record<string, number> }
        actor?: RebalanceEvent['actor']
        source?: RebalanceEvent['source']
        triggerMetadata?: Record<string, unknown>
        eventSource?: RebalanceEvent['eventSource']
        onChainConfirmed?: boolean
        onChainEventType?: string
        onChainTxHash?: string
        onChainLedger?: number
        onChainContractId?: string
        onChainPagingToken?: string
        isSimulated?: boolean
        estimatedSlippageBps?: number
        actualSlippageBps?: number
        slippageExceededTolerance?: boolean
        /** Optional aggregate slippage in basis points for backwards compatibility. */
        totalSlippageBps?: number
        feePaid?: number
        slippageBps?: number
        gasFeeXlm?: number
        gasFeeUsd?: number
        gasPerTradeXlm?: number
        gasWarning?: boolean
        gasBreakdown?: Array<{ tradeId: string, fromAsset?: string, toAsset?: string, feeXlm: number }>
<<<<<<< HEAD
        persistenceContext?: {
            source: PortfolioPersistenceSource
            retryAvailable?: boolean
            stateTransition?: PortfolioPersistenceTransition
        }
=======
        /** Additional details to merge into the event details object. */
        details?: Partial<RebalanceEvent['details']>
>>>>>>> 8ea814a (update made)
    }): Promise<RebalanceEvent> {
        const featureFlags = getFeatureFlags()
        const eventSource: RebalanceEvent['eventSource'] = eventData.eventSource
            || (featureFlags.demoMode ? 'simulated' : 'offchain')
        const details: RebalanceEvent['details'] = {
            fromAsset: eventData.fromAsset,
            toAsset: eventData.toAsset,
            amount: eventData.amount,
            reason: this.generateReasonFromTrigger(eventData.trigger),
            volatilityDetected: this.checkVolatilityInTrigger(eventData.trigger),
            riskLevel: this.assessRiskLevel(eventData.trigger, eventData.status),
            priceDirection: this.determinePriceDirection(eventData.prices),
            performanceImpact: this.assessPerformanceImpact(eventData.status, eventData.trigger),
            estimatedSlippageBps: eventData.estimatedSlippageBps,
            actualSlippageBps: eventData.actualSlippageBps,
            slippageExceededTolerance: eventData.slippageExceededTolerance,
            ...(eventData.totalSlippageBps != null && { totalSlippageBps: eventData.totalSlippageBps }),
            gasFeeXlm: eventData.gasFeeXlm,
            gasFeeUsd: eventData.gasFeeUsd,
            gasPerTradeXlm: eventData.gasPerTradeXlm,
            gasWarning: eventData.gasWarning,
            gasBreakdown: eventData.gasBreakdown,
<<<<<<< HEAD
            ...(eventData.details ?? {}),
        } as RebalanceEvent['details']
=======
            ...eventData.details
        }
>>>>>>> 8ea814a (update made)
        const feePaid = this.deriveFeePaid(eventData, details)
        const slippageBps = this.deriveSlippageBps(eventData)

        if (eventData.prices && eventData.portfolio) {
            try {
                const riskMetrics = this.riskService.analyzePortfolioRisk(
                    eventData.portfolio.allocations,
                    eventData.prices
                )
                if (details) {
                    details.riskMetrics = riskMetrics
                } else {
                    ;(eventData as any).details = { ...((eventData as any).details ?? {}), riskMetrics }
                }
            } catch (error) {
                logger.warn('Failed to calculate risk metrics', { error })
            }
        }

        // Infer actor/source from trigger when not explicitly provided
        const actor = eventData.actor ?? (eventData.isAutomatic ? 'system' : 'user')
        const source = eventData.source ?? (eventData.isAutomatic ? 'auto_rebalance' : 'dashboard')

<<<<<<< HEAD
        const persistedDetails = {
            ...(details as Record<string, unknown>),
            feePaid,
            slippageBps,
            ...(eventData.details ?? {}),
        } as Record<string, unknown>
=======
        // Add extra fields to details for storage in JSONB column
        details.eventSource = eventSource
        details.actor = actor
        details.source = source
        details.triggerMetadata = eventData.triggerMetadata
        details.onChainConfirmed = eventData.onChainConfirmed
        details.onChainEventType = eventData.onChainEventType
        details.onChainTxHash = eventData.onChainTxHash
        details.onChainLedger = eventData.onChainLedger
        details.onChainContractId = eventData.onChainContractId
        details.onChainPagingToken = eventData.onChainPagingToken
        details.isSimulated = eventData.isSimulated

        // Record event in database
        const inserted = await dbInsertRebalanceEvent({
            id: randomUUID(),
            portfolioId: eventData.portfolioId,
            trigger: eventData.trigger,
            trades: eventData.trades,
            gasUsed: eventData.gasUsed,
            feePaid,
            slippageBps,
            status: eventData.status,
            isAutomatic: eventData.isAutomatic ?? false,
            riskAlerts: eventData.riskAlerts ?? [],
            error: eventData.error,
            details,
        })
>>>>>>> 8ea814a (update made)

        const insertedTimestamp =
            eventData.timestamp instanceof Date
                ? eventData.timestamp
                : eventData.timestamp
                  ? new Date(eventData.timestamp)
                  : undefined

        const persistenceContext = eventData.persistenceContext ?? { source: 'other' as const }
        const stateTransition = persistenceContext.stateTransition ?? 'unknown'
        const startedAt = Date.now()
        let event: RebalanceEvent
        try {
            event = await dbInsertRebalanceEvent({
                id: eventData.id,
                portfolioId: eventData.portfolioId,
                trigger: eventData.trigger,
                trades: eventData.trades,
                gasUsed: eventData.gasUsed,
                feePaid,
                slippageBps,
                status: eventData.status,
                isAutomatic: eventData.isAutomatic ?? false,
                riskAlerts: eventData.riskAlerts ?? [],
                error: eventData.error,
                details: persistedDetails,
                timestamp: insertedTimestamp,
                eventSource,
                actor,
                source,
                triggerMetadata: eventData.triggerMetadata,
                onChainConfirmed: eventData.onChainConfirmed,
                onChainEventType: eventData.onChainEventType,
                onChainTxHash: eventData.onChainTxHash,
                onChainLedger: eventData.onChainLedger,
                onChainContractId: eventData.onChainContractId,
                onChainPagingToken: eventData.onChainPagingToken,
                isSimulated: eventData.isSimulated,
            })
        } catch (error) {
            const outcome: PortfolioPersistenceOutcome = persistenceContext.retryAvailable
                ? 'delayed'
                : 'blocked'
            const diagnostics = {
                operation: 'record_rebalance_event',
                source: persistenceContext.source,
                outcome,
                eventStatus: eventData.status,
                stateTransition,
                retryAvailable: persistenceContext.retryAvailable ?? false,
                portfolioBucket: bucketPortfolioId(eventData.portfolioId),
                durationMs: Date.now() - startedAt,
                errorType: error instanceof Error ? 'Error' : 'NonError',
                databaseErrorCode: getSafeDatabaseErrorCode(error),
            }
            recordPortfolioPersistenceOutcome({
                source: persistenceContext.source,
                outcome,
                eventStatus: eventData.status,
                stateTransition,
            })
            if (outcome === 'delayed') {
                logger.warn(diagnostics, 'Portfolio persistence write delayed')
            } else {
                logger.error(diagnostics, 'Portfolio persistence write blocked')
            }
            throw error
        }

        recordPortfolioPersistenceOutcome({
            source: persistenceContext.source,
            outcome: 'success',
            eventStatus: eventData.status,
            stateTransition,
        })
        logger.info('[REBALANCE-HISTORY] Recorded rebalance event', {
            eventId: event.id,
            isAutomatic: eventData.isAutomatic ?? false,
            actor,
            source: persistenceContext.source,
            outcome: 'success',
            eventStatus: eventData.status,
            stateTransition,
            portfolioBucket: bucketPortfolioId(eventData.portfolioId),
            durationMs: Date.now() - startedAt,
        })
        return event
    }

    async getRebalanceHistory(
        portfolioId?: string,
        limit: number = 50,
        options: RebalanceHistoryQueryOptions = {},
        offset: number = 0
    ): Promise<RebalanceEvent[]> {
        if (isDbConfigured()) {
            if (portfolioId) {
                return dbGetRebalanceHistoryByPortfolio(portfolioId, limit, offset)
            }
            return dbGetRebalanceHistoryAll(limit, offset)
        }
        return databaseService.getRebalanceHistory(portfolioId, limit, options)
    }

    /**
     * Fetches a portfolio's rebalance history for full export, optionally
     * restricted to an ISO date range (applied in-memory on parsed timestamps).
     */
    async getRebalanceHistoryForExport(
        portfolioId: string,
        filters: { from?: string; to?: string } = {},
        limit: number = 10_000
    ): Promise<RebalanceEvent[]> {
        const events = isDbConfigured()
            ? await dbGetRebalanceHistoryByPortfolio(portfolioId, limit, 0)
            : databaseService.getRebalanceHistory(portfolioId, limit)
        const fromMs = filters.from ? Date.parse(filters.from) : NaN
        const toMs = filters.to ? Date.parse(filters.to) : NaN
        if (Number.isNaN(fromMs) && Number.isNaN(toMs)) {
            return events
        }
        return events.filter((event) => {
            const ts = Date.parse(event.timestamp)
            if (!Number.isNaN(fromMs) && ts < fromMs) return false
            if (!Number.isNaN(toMs) && ts > toMs) return false
            return true
        })
    }

    async getRecentAutoRebalances(portfolioId: string, limit: number = 10): Promise<RebalanceEvent[]> {
        try {
            if (isDbConfigured()) {
                return dbGetRecentAutoRebalances(portfolioId, limit)
            }
            return databaseService.getRecentAutoRebalances(portfolioId, limit)
        } catch (error) {
            logger.error('Error getting recent auto-rebalances', { error })
            return []
        }
    }

    async getAutoRebalancesSince(portfolioId: string, since: Date): Promise<RebalanceEvent[]> {
        try {
            if (isDbConfigured()) {
                return dbGetAutoRebalancesSince(portfolioId, since)
            }
            return databaseService.getAutoRebalancesSince(portfolioId, since)
        } catch (error) {
            logger.error('Error getting auto-rebalances since date', { error })
            return []
        }
    }

    async getAllAutoRebalances(limit: number = 1000): Promise<RebalanceEvent[]> {
        try {
            if (isDbConfigured()) {
                return dbGetAllAutoRebalances()
            }
            return databaseService.getAllAutoRebalances()
        } catch (error) {
            logger.error('Error getting all auto-rebalances', { error })
            return []
        }
    }

    // ─── Private helpers (kept for semantic consistency) ───────────────────────

    private generateReasonFromTrigger(trigger: string): string {
        if (trigger.includes('Threshold exceeded')) {
            return `Portfolio allocation drift exceeded rebalancing threshold`
        }
        if (trigger.includes('Scheduled') || trigger.includes('Automatic')) {
            return 'Automated scheduled rebalancing executed'
        }
        if (trigger.includes('Volatility') || trigger.includes('circuit breaker')) {
            return 'High market volatility detected, protective rebalance executed'
        }
        if (trigger.includes('Manual')) {
            return 'User-initiated manual rebalancing'
        }
        if (trigger.includes('Risk')) {
            return 'Risk management system triggered rebalancing'
        }
        return `Rebalancing triggered: ${trigger}`
    }

    private checkVolatilityInTrigger(trigger: string): boolean {
        const volatilityKeywords = ['volatility', 'circuit breaker', 'risk', 'emergency']
        return volatilityKeywords.some(keyword => trigger.toLowerCase().includes(keyword))
    }

    private assessRiskLevel(trigger: string, status: string): 'low' | 'medium' | 'high' {
        if (status === 'failed') return 'high'

        if (trigger.includes('Volatility') || trigger.includes('circuit breaker') || trigger.includes('emergency')) {
            return 'high'
        }

        if (trigger.includes('Threshold exceeded')) {
            const match = trigger.match(/(\d+\.?\d*)%/)
            if (match) {
                const percentage = parseFloat(match[1])
                if (percentage > 10) return 'high'
                if (percentage > 5) return 'medium'
            }
            return 'medium'
        }

        if (trigger.includes('Scheduled') || trigger.includes('Manual') || trigger.includes('Automatic')) {
            return 'low'
        }

        return 'medium'
    }

    private determinePriceDirection(prices?: PricesMap): 'up' | 'down' {
        if (!prices) return 'down'
        const changes = Object.values(prices).map((p: any) => p.change || 0)
        const averageChange = changes.reduce((sum, change) => sum + change, 0) / changes.length
        return averageChange >= 0 ? 'up' : 'down'
    }

    private assessPerformanceImpact(status: string, trigger: string): 'positive' | 'negative' | 'neutral' {
        if (status === 'failed') return 'negative'
        if (trigger.includes('Volatility') || trigger.includes('circuit breaker')) return 'negative'
        if (trigger.includes('Scheduled') || trigger.includes('Automatic')) return 'positive'
        if (trigger.includes('Threshold exceeded')) return 'neutral'
        return 'neutral'
    }

    // Generate some initial demo data
    initializeDemoData(portfolioId: string): void {
        /* no-op: demo data seeding lives in DatabaseService */
    }

    // Clear all history (for testing)
    clearHistory(): void {
        /* no-op: history clearing lives in DatabaseService */
    }

    async getHistoryStats(): Promise<{ totalEvents: number; portfolios: number; recentActivity: number; autoRebalances: number }> {
        if (isDbConfigured()) {
            return dbGetHistoryStats()
        }
        return databaseService.getHistoryStats()
    }

    async getRebalanceHistoryCount(portfolioId: string): Promise<number> {
        if (isDbConfigured()) {
            return dbGetRebalanceHistoryCountByPortfolio(portfolioId)
        }
        return databaseService.getRebalanceHistoryCount(portfolioId)
    }

    async getCostSummary(portfolioId: string): Promise<RebalanceCostSummary> {
        if (isDbConfigured()) {
            return dbGetRebalanceCostSummary(portfolioId)
        }
        const history = databaseService.getRebalanceHistory(portfolioId, 1000)
        const totalFees = history.reduce((sum, e) => sum + (e.feePaid ?? 0), 0)
        const slippages = history.map(e => e.slippageBps).filter((s): s is number => typeof s === 'number')
        const avgSlippage = slippages.length > 0 ? slippages.reduce((a, b) => a + b, 0) / slippages.length : 0
        return {
            total_fees_paid: totalFees,
            avg_slippage_bps: avgSlippage,
            cost_per_rebalance: history.length > 0 ? totalFees / history.length : 0,
            total_rebalances: history.length
        }
    }

    private deriveFeePaid(
        eventData: {
            feePaid?: number
            gasFeeXlm?: number
            gasBreakdown?: Array<{ feeXlm: number }>
        },
        details: RebalanceEvent['details']
    ): number {
        if (typeof eventData.feePaid === 'number' && Number.isFinite(eventData.feePaid)) {
            return Math.max(0, eventData.feePaid)
        }
        if (typeof eventData.gasFeeXlm === 'number' && Number.isFinite(eventData.gasFeeXlm)) {
            return Math.max(0, eventData.gasFeeXlm)
        }
        const breakdownTotal = details?.gasBreakdown?.reduce((sum, item) => {
            const fee = Number(item.feeXlm)
            return sum + (Number.isFinite(fee) ? fee : 0)
        }, 0)
        return Math.max(0, breakdownTotal ?? 0)
    }

    private deriveSlippageBps(eventData: {
        slippageBps?: number
        actualSlippageBps?: number
        totalSlippageBps?: number
        estimatedSlippageBps?: number
    }): number {
        const candidates = [
            eventData.slippageBps,
            eventData.actualSlippageBps,
            eventData.totalSlippageBps,
            eventData.estimatedSlippageBps
        ]
        const value = candidates.find((candidate) => typeof candidate === 'number' && Number.isFinite(candidate))
        return Math.max(0, value ?? 0)
    }
}
