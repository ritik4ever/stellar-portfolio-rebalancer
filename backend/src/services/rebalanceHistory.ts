import { RiskManagementService } from './riskManagements.js'
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
    }
}

export class RebalanceHistoryService {
    private riskService: RiskManagementService

    constructor(riskService?: RiskManagementService) {
        this.riskService = riskService ?? new RiskManagementService()
    }

    async recordRebalanceEvent(eventData: {
        portfolioId: string
        trigger: string
        trades: number
        gasUsed: string
        status: 'completed' | 'failed' | 'pending'
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
            gasBreakdown: eventData.gasBreakdown
        }
        const feePaid = this.deriveFeePaid(eventData, details)
        const slippageBps = this.deriveSlippageBps(eventData)

        if (eventData.prices && eventData.portfolio) {
            try {
                const riskMetrics = this.riskService.analyzePortfolioRisk(
                    eventData.portfolio.allocations,
                    eventData.prices
                )
                details.riskMetrics = riskMetrics
            } catch (error) {
                logger.warn('Failed to calculate risk metrics', { error })
            }
        }

        // Infer actor/source from trigger when not explicitly provided
        const actor = eventData.actor ?? (eventData.isAutomatic ? 'system' : 'user')
        const source = eventData.source ?? (eventData.isAutomatic ? 'auto_rebalance' : 'dashboard')

        // Record event in database
        const inserted = await dbInsertRebalanceEvent({
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
            isSimulated: eventData.isSimulated
        })

        const event: RebalanceEvent = {
            id: inserted.id,
            portfolioId: eventData.portfolioId,
            timestamp: new Date().toISOString(),
            trigger: eventData.trigger,
            trades: eventData.trades,
            gasUsed: eventData.gasUsed,
            feePaid,
            slippageBps,
            status: eventData.status,
            isAutomatic: eventData.isAutomatic ?? false,
            riskAlerts: eventData.riskAlerts ?? [],
            error: eventData.error,
            actor,
            source,
            triggerMetadata: eventData.triggerMetadata,
            eventSource,
            onChainConfirmed: eventData.onChainConfirmed,
            onChainEventType: eventData.onChainEventType,
            onChainTxHash: eventData.onChainTxHash,
            onChainLedger: eventData.onChainLedger,
            onChainContractId: eventData.onChainContractId,
            onChainPagingToken: eventData.onChainPagingToken,
            isSimulated: eventData.isSimulated,
            details: {
                ...details,
                feePaid,
                slippageBps
            },
        }

        logger.info('[REBALANCE-HISTORY] Recorded rebalance event', {
            eventId: event.id,
            isAutomatic: eventData.isAutomatic ?? false,
            actor,
            source
        })
        return event
    }

    async getRebalanceHistory(
        portfolioId?: string,
        limit: number = 50,
        options: RebalanceHistoryQueryOptions = {},
        offset: number = 0
    ): Promise<RebalanceEvent[]> {
        // Always use databaseService (SQLite)
        if (portfolioId) {
          return dbGetRebalanceHistoryByPortfolio(portfolioId, limit, offset)
        }
        return dbGetRebalanceHistoryAll(limit, offset)
    }

    async getRecentAutoRebalances(portfolioId: string, limit: number = 10): Promise<RebalanceEvent[]> {
        try {
            // Always use databaseService (SQLite)
            return dbGetRecentAutoRebalances(portfolioId, limit)
        } catch (error) {
            logger.error('Error getting recent auto-rebalances', { error })
            return []
        }
    }

    async getAutoRebalancesSince(portfolioId: string, since: Date): Promise<RebalanceEvent[]> {
        try {
            // Always use databaseService (SQLite)
            return dbGetAutoRebalancesSince(portfolioId, since)
        } catch (error) {
            logger.error('Error getting auto-rebalances since date', { error })
            return []
        }
    }

    async getAllAutoRebalances(limit: number = 1000): Promise<RebalanceEvent[]> {
        try {
            // Always use databaseService (SQLite)
            return dbGetAllAutoRebalances()
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
        return dbGetHistoryStats()
    }

    async getRebalanceHistoryCount(portfolioId: string): Promise<number> {
        return dbGetRebalanceHistoryCountByPortfolio(portfolioId)
    }

    async getCostSummary(portfolioId: string): Promise<RebalanceCostSummary> {
        return dbGetRebalanceCostSummary(portfolioId)
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
