import { RiskManagementService } from './riskManagements.js'
import { databaseService, type RebalanceHistoryQueryOptions } from './databaseService.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import type { PricesMap, RebalanceReasonCode } from '../types/index.js'
import { logger } from '../utils/logger.js'

export interface RebalanceEvent {
    id: string
    portfolioId: string
    timestamp: string
    trigger: string
    reasonCode?: RebalanceReasonCode
    trades: number
    gasUsed: string
    status: 'completed' | 'failed' | 'pending'
    isAutomatic?: boolean
    riskAlerts?: any[]
    error?: string
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
        reasonCode?: RebalanceReasonCode
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
            reason: this.generateReasonFromTrigger(eventData.trigger, eventData.reasonCode),
            volatilityDetected: this.checkVolatilityInTrigger(eventData.trigger, eventData.reasonCode),
            riskLevel: this.assessRiskLevel(eventData.trigger, eventData.status, eventData.reasonCode),
            priceDirection: this.determinePriceDirection(eventData.prices),
            performanceImpact: this.assessPerformanceImpact(eventData.status, eventData.trigger, eventData.reasonCode),
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

        // Record event in database
        const event = databaseService.recordRebalanceEvent({
            portfolioId: eventData.portfolioId,
            trigger: eventData.trigger,
            reasonCode: eventData.reasonCode,
            trades: eventData.trades,
            gasUsed: eventData.gasUsed,
            status: eventData.status,
            isAutomatic: eventData.isAutomatic ?? false,
            riskAlerts: eventData.riskAlerts ?? [],
            error: eventData.error,
            details,
            eventSource,
            onChainConfirmed: eventData.onChainConfirmed,
            onChainEventType: eventData.onChainEventType,
            onChainTxHash: eventData.onChainTxHash,
            onChainLedger: eventData.onChainLedger,
            onChainContractId: eventData.onChainContractId,
            onChainPagingToken: eventData.onChainPagingToken,
            isSimulated: eventData.isSimulated
        })

        logger.info('[REBALANCE-HISTORY] Recorded rebalance event', {
            eventId: event.id,
            isAutomatic: eventData.isAutomatic ?? false,
            reasonCode: eventData.reasonCode
        })
        return event
    }

    async getRebalanceHistory(
        portfolioId?: string,
        limit: number = 50,
        options: RebalanceHistoryQueryOptions = {}
    ): Promise<RebalanceEvent[]> {
        // Always use databaseService (SQLite)
        return databaseService.getRebalanceHistory(portfolioId, limit, options)
    }

    async getRecentAutoRebalances(portfolioId: string, limit: number = 10): Promise<RebalanceEvent[]> {
        try {
            // Always use databaseService (SQLite)
            return databaseService.getRecentAutoRebalances(portfolioId, limit)
        } catch (error) {
            logger.error('Error getting recent auto-rebalances', { error })
            return []
        }
    }

    async getAutoRebalancesSince(portfolioId: string, since: Date): Promise<RebalanceEvent[]> {
        try {
            // Always use databaseService (SQLite)
            return databaseService.getAutoRebalancesSince(portfolioId, since)
        } catch (error) {
            logger.error('Error getting auto-rebalances since date', { error })
            return []
        }
    }

    async getAllAutoRebalances(limit: number = 1000): Promise<RebalanceEvent[]> {
        try {
            // Always use databaseService (SQLite)
            return databaseService.getAllAutoRebalances()
        } catch (error) {
            logger.error('Error getting all auto-rebalances', { error })
            return []
        }
    }

    // ─── Private helpers (kept for semantic consistency) ───────────────────────

    private generateReasonFromTrigger(trigger: string, reasonCode?: RebalanceReasonCode): string {
        if (reasonCode === 'THRESHOLD_EXCEEDED' || trigger.includes('Threshold exceeded')) {
            return `Portfolio allocation drift exceeded rebalancing threshold`
        }
        if (reasonCode === 'SCHEDULED_REBALANCE' || trigger.includes('Scheduled') || trigger.includes('Automatic')) {
            return 'Automated scheduled rebalancing executed'
        }
        if (reasonCode === 'VOLATILITY_CIRCUIT_BREAKER' || trigger.includes('Volatility') || trigger.includes('circuit breaker')) {
            return 'High market volatility detected, protective rebalance executed'
        }
        if (reasonCode === 'MANUAL_USER_REQUEST' || trigger.includes('Manual')) {
            return 'User-initiated manual rebalancing'
        }
        if (reasonCode === 'RISK_MITIGATION' || trigger.includes('Risk')) {
            return 'Risk management system triggered rebalancing'
        }
        if (reasonCode === 'ON_CHAIN_SYNC') {
            return 'Synchronized from on-chain event'
        }
        return `Rebalancing triggered: ${trigger}`
    }

    private checkVolatilityInTrigger(trigger: string, reasonCode?: RebalanceReasonCode): boolean {
        if (reasonCode === 'VOLATILITY_CIRCUIT_BREAKER') return true
        const volatilityKeywords = ['volatility', 'circuit breaker', 'risk', 'emergency']
        return volatilityKeywords.some(keyword => trigger.toLowerCase().includes(keyword))
    }

    private assessRiskLevel(trigger: string, status: string, reasonCode?: RebalanceReasonCode): 'low' | 'medium' | 'high' {
        if (status === 'failed') return 'high'

        if (reasonCode === 'VOLATILITY_CIRCUIT_BREAKER' || trigger.includes('Volatility') || trigger.includes('circuit breaker') || trigger.includes('emergency')) {
            return 'high'
        }

        if (reasonCode === 'THRESHOLD_EXCEEDED' || trigger.includes('Threshold exceeded')) {
            const match = trigger.match(/(\d+\.?\d*)%/)
            if (match) {
                const percentage = parseFloat(match[1])
                if (percentage > 10) return 'high'
                if (percentage > 5) return 'medium'
            }
            return 'medium'
        }

        if (reasonCode === 'SCHEDULED_REBALANCE' || reasonCode === 'MANUAL_USER_REQUEST' || trigger.includes('Scheduled') || trigger.includes('Manual') || trigger.includes('Automatic')) {
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

    private assessPerformanceImpact(status: string, trigger: string, reasonCode?: RebalanceReasonCode): 'positive' | 'negative' | 'neutral' {
        if (status === 'failed') return 'negative'
        if (reasonCode === 'VOLATILITY_CIRCUIT_BREAKER' || trigger.includes('Volatility') || trigger.includes('circuit breaker')) return 'negative'
        if (reasonCode === 'SCHEDULED_REBALANCE' || trigger.includes('Scheduled') || trigger.includes('Automatic')) return 'positive'
        if (reasonCode === 'THRESHOLD_EXCEEDED' || trigger.includes('Threshold exceeded')) return 'neutral'
        return 'neutral'
    }

    // Generate some initial demo data
    initializeDemoData(portfolioId: string): void {
        databaseService.initializeDemoData(portfolioId)
    }

    // Clear all history (for testing)
    clearHistory(): void {
        databaseService.clearHistory()
    }

    async getHistoryStats(): Promise<{ totalEvents: number; portfolios: number; recentActivity: number; autoRebalances: number }> {
        return databaseService.getHistoryStats()
    }
}
