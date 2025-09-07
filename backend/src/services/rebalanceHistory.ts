import { RiskManagementService, RiskAlert } from './riskManagements.js'
import type { PricesMap } from '../types/index.js'

export interface RebalanceEvent {
    id: string
    portfolioId: string
    timestamp: string
    trigger: string
    trades: number
    gasUsed: string
    status: 'completed' | 'failed' | 'pending'
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
    private history: Map<string, RebalanceEvent[]> = new Map()
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
        fromAsset?: string
        toAsset?: string
        amount?: number
        prices?: PricesMap
        portfolio?: any
    }): Promise<RebalanceEvent> {
        const event: RebalanceEvent = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            portfolioId: eventData.portfolioId,
            timestamp: new Date().toISOString(),
            trigger: eventData.trigger,
            trades: eventData.trades,
            gasUsed: eventData.gasUsed,
            status: eventData.status,
            details: {
                fromAsset: eventData.fromAsset,
                toAsset: eventData.toAsset,
                amount: eventData.amount,
                reason: this.generateReasonFromTrigger(eventData.trigger),
                volatilityDetected: this.checkVolatilityInTrigger(eventData.trigger),
                riskLevel: this.assessRiskLevel(eventData.trigger, eventData.status),
                priceDirection: this.determinePriceDirection(eventData.prices),
                performanceImpact: this.assessPerformanceImpact(eventData.status, eventData.trigger)
            }
        }

        // Add risk metrics if available
        if (eventData.prices && eventData.portfolio) {
            try {
                const riskMetrics = this.riskService.analyzePortfolioRisk(eventData.portfolio.allocations, eventData.prices)
                event.details!.riskMetrics = riskMetrics
            } catch (error) {
                console.warn('Failed to calculate risk metrics:', error)
            }
        }

        // Store the event
        const portfolioHistory = this.history.get(eventData.portfolioId) || []
        portfolioHistory.unshift(event) // Add to beginning

        // Keep only last 100 events per portfolio
        if (portfolioHistory.length > 100) {
            portfolioHistory.splice(100)
        }

        this.history.set(eventData.portfolioId, portfolioHistory)

        console.log(`[INFO] Rebalance event recorded: ${event.id} for portfolio ${eventData.portfolioId}`)
        return event
    }

    async getRebalanceHistory(portfolioId?: string, limit: number = 50): Promise<RebalanceEvent[]> {
        if (portfolioId) {
            const portfolioHistory = this.history.get(portfolioId) || []
            return portfolioHistory.slice(0, limit)
        }

        // Get history for all portfolios
        const allEvents: RebalanceEvent[] = []
        this.history.forEach(events => {
            allEvents.push(...events)
        })

        // Sort by timestamp descending and limit
        return allEvents
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit)
    }

    private generateReasonFromTrigger(trigger: string): string {
        if (trigger.includes('Threshold exceeded')) {
            return `Portfolio allocation drift exceeded rebalancing threshold`
        }
        if (trigger.includes('Scheduled')) {
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
        return volatilityKeywords.some(keyword =>
            trigger.toLowerCase().includes(keyword)
        )
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

        if (trigger.includes('Scheduled') || trigger.includes('Manual')) {
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

        if (trigger.includes('Volatility') || trigger.includes('circuit breaker')) {
            return 'negative' // Protective action due to bad market conditions
        }

        if (trigger.includes('Scheduled')) {
            return 'positive' // Proactive maintenance
        }

        if (trigger.includes('Threshold exceeded')) {
            return 'neutral' // Corrective action
        }

        return 'neutral'
    }

    // Generate some initial demo data
    initializeDemoData(portfolioId: string): void {
        const demoEvents: RebalanceEvent[] = [
            {
                id: '1',
                portfolioId,
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
                trigger: 'Threshold exceeded (8.2%)',
                trades: 3,
                gasUsed: '0.0234 XLM',
                status: 'completed',
                details: {
                    fromAsset: 'XLM',
                    toAsset: 'ETH',
                    amount: 1200,
                    reason: 'Portfolio allocation drift exceeded rebalancing threshold',
                    riskLevel: 'medium',
                    priceDirection: 'down',
                    performanceImpact: 'neutral'
                }
            },
            {
                id: '2',
                portfolioId,
                timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
                trigger: 'Scheduled rebalance',
                trades: 2,
                gasUsed: '0.0156 XLM',
                status: 'completed',
                details: {
                    reason: 'Automated scheduled rebalancing executed',
                    riskLevel: 'low',
                    priceDirection: 'up',
                    performanceImpact: 'positive'
                }
            },
            {
                id: '3',
                portfolioId,
                timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                trigger: 'Volatility circuit breaker',
                trades: 1,
                gasUsed: '0.0089 XLM',
                status: 'completed',
                details: {
                    reason: 'High market volatility detected, protective rebalance executed',
                    volatilityDetected: true,
                    riskLevel: 'high',
                    priceDirection: 'down',
                    performanceImpact: 'negative'
                }
            }
        ]

        this.history.set(portfolioId, demoEvents)
    }

    // Clear all history (for testing)
    clearHistory(): void {
        this.history.clear()
    }

    // Get statistics
    getHistoryStats(): { totalEvents: number, portfolios: number, recentActivity: number } {
        let totalEvents = 0
        let recentActivity = 0
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000)

        this.history.forEach(events => {
            totalEvents += events.length
            recentActivity += events.filter(e =>
                new Date(e.timestamp).getTime() > oneDayAgo
            ).length
        })

        return {
            totalEvents,
            portfolios: this.history.size,
            recentActivity
        }
    }
}