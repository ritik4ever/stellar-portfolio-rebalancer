import { portfolioStorage } from './portfolioStorage.js'
import { ReflectorService } from './reflector.js'
import { logger } from '../utils/logger.js'

interface PortfolioSnapshot {
    portfolioId: string
    timestamp: string
    totalValue: number
    allocations: Record<string, number>
    balances: Record<string, number>
}

interface PerformanceMetrics {
    totalReturn: number
    dailyChange: number
    weeklyChange: number
    maxDrawdown: number
    bestDay: { date: string; change: number }
    worstDay: { date: string; change: number }
    sharpeRatio: number
    volatility: number
}

class AnalyticsService {
    private snapshots: Map<string, PortfolioSnapshot[]> = new Map()
    private snapshotInterval: NodeJS.Timeout | null = null
    private lastSnapshotTimes: Map<string, number> = new Map()
    private readonly MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

    constructor() {
        this.startPeriodicSnapshots()
    }

    private startPeriodicSnapshots() {
        const intervalMs = 60 * 60 * 1000

        this.snapshotInterval = setInterval(async () => {
            await this.captureAllPortfolios()
        }, intervalMs)

        this.captureAllPortfolios()
    }

    private async captureAllPortfolios() {
        try {
            const portfolios = portfolioStorage.getAllPortfolios()
            const reflector = new ReflectorService()
            const prices = await reflector.getCurrentPrices()

            for (const portfolio of portfolios) {
                await this.captureSnapshot(portfolio.id, prices)
            }
        } catch (error) {
            logger.error('Failed to capture portfolio snapshots', { error })
        }
    }

    async captureSnapshot(portfolioId: string, prices?: Record<string, any>) {
        try {
            const portfolio = portfolioStorage.getPortfolio(portfolioId)
            if (!portfolio) {
                return
            }

            const now = Date.now()
            const lastSnapshotTime = this.lastSnapshotTimes.get(portfolioId) || 0
            if (now - lastSnapshotTime < this.MIN_SNAPSHOT_INTERVAL_MS) {
                return
            }

            if (!prices) {
                const reflector = new ReflectorService()
                prices = await reflector.getCurrentPrices()
            }

            let totalValue = 0
            const allocations: Record<string, number> = {}

            for (const [asset, balance] of Object.entries(portfolio.balances)) {
                const price = prices[asset]?.price || 0
                const value = balance * price
                totalValue += value
            }

            for (const [asset, balance] of Object.entries(portfolio.balances)) {
                const price = prices[asset]?.price || 0
                const value = balance * price
                allocations[asset] = totalValue > 0 ? (value / totalValue) * 100 : 0
            }

            const snapshot: PortfolioSnapshot = {
                portfolioId,
                timestamp: new Date().toISOString(),
                totalValue,
                allocations,
                balances: { ...portfolio.balances }
            }

            if (!this.snapshots.has(portfolioId)) {
                this.snapshots.set(portfolioId, [])
            }

            const snapshots = this.snapshots.get(portfolioId)!
            snapshots.push(snapshot)
            this.lastSnapshotTimes.set(portfolioId, now)

            const maxSnapshots = 1000
            if (snapshots.length > maxSnapshots) {
                snapshots.shift()
            }

            logger.info('Portfolio snapshot captured', { portfolioId, totalValue })
        } catch (error) {
            logger.error('Failed to capture snapshot', { portfolioId, error })
        }
    }

    getAnalytics(portfolioId: string, days: number = 30): PortfolioSnapshot[] {
        const snapshots = this.snapshots.get(portfolioId) || []
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - days)

        return snapshots.filter(snapshot => {
            const snapshotDate = new Date(snapshot.timestamp)
            return snapshotDate >= cutoffDate
        })
    }

    calculatePerformanceMetrics(portfolioId: string): PerformanceMetrics {
        const snapshots = this.getAnalytics(portfolioId, 90)
        
        if (snapshots.length < 2) {
            return {
                totalReturn: 0,
                dailyChange: 0,
                weeklyChange: 0,
                maxDrawdown: 0,
                bestDay: { date: '', change: 0 },
                worstDay: { date: '', change: 0 },
                sharpeRatio: 0,
                volatility: 0
            }
        }

        const sortedSnapshots = [...snapshots].sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )

        const initialValue = sortedSnapshots[0].totalValue
        const finalValue = sortedSnapshots[sortedSnapshots.length - 1].totalValue
        const totalReturn = initialValue > 0 ? ((finalValue - initialValue) / initialValue) * 100 : 0

        const dailyChanges: number[] = []
        const dailyChangeData: Array<{ date: string; change: number }> = []

        for (let i = 1; i < sortedSnapshots.length; i++) {
            const prevValue = sortedSnapshots[i - 1].totalValue
            const currValue = sortedSnapshots[i].totalValue
            const change = prevValue > 0 ? ((currValue - prevValue) / prevValue) * 100 : 0
            dailyChanges.push(change)
            dailyChangeData.push({
                date: sortedSnapshots[i].timestamp,
                change
            })
        }

        const dailyChange = dailyChanges.length > 0 ? dailyChanges[dailyChanges.length - 1] : 0

        const weekAgoIndex = Math.max(0, sortedSnapshots.length - 7)
        const weekAgoValue = sortedSnapshots[weekAgoIndex].totalValue
        const weeklyChange = weekAgoValue > 0 ? ((finalValue - weekAgoValue) / weekAgoValue) * 100 : 0

        let maxDrawdown = 0
        let peak = initialValue
        for (const snapshot of sortedSnapshots) {
            if (snapshot.totalValue > peak) {
                peak = snapshot.totalValue
            }
            const drawdown = peak > 0 ? ((peak - snapshot.totalValue) / peak) * 100 : 0
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown
            }
        }

        const bestDay = dailyChangeData.reduce((best, current) => 
            current.change > best.change ? current : best, 
            { date: '', change: -Infinity }
        )

        const worstDay = dailyChangeData.reduce((worst, current) => 
            current.change < worst.change ? current : worst, 
            { date: '', change: Infinity }
        )

        const meanChange = dailyChanges.length > 0 
            ? dailyChanges.reduce((sum, change) => sum + change, 0) / dailyChanges.length 
            : 0

        const variance = dailyChanges.length > 0
            ? dailyChanges.reduce((sum, change) => sum + Math.pow(change - meanChange, 2), 0) / dailyChanges.length
            : 0

        const volatility = Math.sqrt(variance)

        const riskFreeRate = 0.02 / 365
        const excessReturn = (meanChange / 100) - riskFreeRate
        const sharpeRatio = volatility > 0 ? (excessReturn / (volatility / 100)) * Math.sqrt(365) : 0

        return {
            totalReturn,
            dailyChange,
            weeklyChange,
            maxDrawdown,
            bestDay: bestDay.change !== -Infinity ? bestDay : { date: '', change: 0 },
            worstDay: worstDay.change !== Infinity ? worstDay : { date: '', change: 0 },
            sharpeRatio,
            volatility
        }
    }

    getPerformanceSummary(portfolioId: string) {
        const metrics = this.calculatePerformanceMetrics(portfolioId)
        const snapshots = this.getAnalytics(portfolioId, 30)
        
        return {
            metrics,
            dataPoints: snapshots.length,
            period: '30 days',
            lastUpdated: snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : null
        }
    }

    stop() {
        if (this.snapshotInterval) {
            clearInterval(this.snapshotInterval)
            this.snapshotInterval = null
        }
    }
}

export const analyticsService = new AnalyticsService()
export type { PortfolioSnapshot, PerformanceMetrics }
