import { RiskManagementService } from './riskManagements.js'
import { databaseService, type RebalanceHistoryQueryOptions } from './databaseService.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import type { PricesMap } from '../types/index.js'

export interface RebalanceEvent {
    id: string
    portfolioId: string
    timestamp: string
    trigger: string
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
    }
}

export class RebalanceHistoryService {
    private riskService: RiskManagementService

    constructor() {
        this.riskService = new RiskManagementService()
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
        portfolio?: any
        eventSource?: RebalanceEvent['eventSource']
        onChainConfirmed?: boolean
        onChainEventType?: string
        onChainTxHash?: string
        onChainLedger?: number
        onChainContractId?: string
        onChainPagingToken?: string
        isSimulated?: boolean
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
            performanceImpact: this.assessPerformanceImpact(eventData.status, eventData.trigger)
        }

        // Add risk metrics if available
        if (eventData.prices && eventData.portfolio) {
            try {
                const riskMetrics = this.riskService.analyzePortfolioRisk(
                    eventData.portfolio.allocations,
                    eventData.prices
                )
                details.riskMetrics = riskMetrics
            } catch (error) {
                console.warn('Failed to calculate risk metrics:', error)
            }
        }

        // Record event in database
        const event = databaseService.recordRebalanceEvent({
            portfolioId: eventData.portfolioId,
            trigger: eventData.trigger,
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

        console.log(`[REBALANCE-HISTORY] Recorded ${eventData.isAutomatic ? 'automatic' : 'manual'} rebalance event:`, event.id)
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
            console.error('Error getting recent auto-rebalances:', error)
            return []
        }
    }

    async getAutoRebalancesSince(portfolioId: string, since: Date): Promise<RebalanceEvent[]> {
        try {
            // Always use databaseService (SQLite)
            return databaseService.getAutoRebalancesSince(portfolioId, since)
        } catch (error) {
            console.error('Error getting auto-rebalances since date:', error)
            return []
        }
    }

    async getAllAutoRebalances(limit: number = 1000): Promise<RebalanceEvent[]> {
        try {
            // Always use databaseService (SQLite)
            return databaseService.getAllAutoRebalances()
        } catch (error) {
            console.error('Error getting all auto-rebalances:', error)
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
