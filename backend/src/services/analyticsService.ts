import { portfolioStorage } from './portfolioStorage.js'
import { ReflectorService } from './reflector.js'
import { logger } from '../utils/logger.js'
import { dbCompactAnalyticsSnapshots, type CompactionStats } from '../db/analyticsDb.js'

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
    private lastSnapshotTimes: Map<string, number> = new Map()
    private readonly MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

    // NOTE: No setInterval here. Periodic snapshots are driven by
    // the BullMQ analytics-snapshot worker (src/queue/workers/analyticsSnapshotWorker.ts).

    /**
     * Capture snapshots for every portfolio.
     * Called by the BullMQ analytics-snapshot worker.
     */
    async captureAllPortfolios() {
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
            if (!portfolio) return

            const now = Date.now()
            const lastSnapshotTime = this.lastSnapshotTimes.get(portfolioId) || 0
            if (now - lastSnapshotTime < this.MIN_SNAPSHOT_INTERVAL_MS) return

            if (!prices) {
                const reflector = new ReflectorService()
                prices = await reflector.getCurrentPrices()
            }

            let totalValue = 0
            const allocations: Record<string, number> = {}
            const balancesMap = portfolio.balances ?? {}


            for (const [asset, balance] of Object.entries(balancesMap)) {
                const price = prices[asset]?.price || 0
                const value = Number(balance) * price
                totalValue += value
            }

            for (const [asset, balance] of Object.entries(balancesMap)) {
                const price = prices[asset]?.price || 0
                const value = Number(balance) * price
                allocations[asset] = totalValue > 0 ? (value / totalValue) * 100 : 0
            }

            const snapshot: PortfolioSnapshot = {
                portfolioId,
                timestamp: new Date().toISOString(),
                totalValue,
                allocations,
                balances: { ...portfolio.balances },
            }

            if (!this.snapshots.has(portfolioId)) {
                this.snapshots.set(portfolioId, [])
            }

            const snapshotsForPortfolio = this.snapshots.get(portfolioId)!
            snapshotsForPortfolio.push(snapshot)
            this.lastSnapshotTimes.set(portfolioId, now)

            const maxSnapshots = 1000
            if (snapshotsForPortfolio.length > maxSnapshots) {
                snapshotsForPortfolio.shift()
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

    getAnalyticsInRange(portfolioId: string, from: string, to: string): PortfolioSnapshot[] {
        const snapshots = this.snapshots.get(portfolioId) || []
        const fromDate = new Date(from)
        const toDate = new Date(to)

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            return []
        }

        return snapshots
            .filter(snapshot => {
                const snapshotDate = new Date(snapshot.timestamp)
                return snapshotDate >= fromDate && snapshotDate <= toDate
            })
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    }

    getAggregatedAnalytics(portfolioId: string, interval: 'daily' | 'weekly' | 'monthly', days: number = 30): PortfolioSnapshot[] {
        const snapshots = this.getAnalytics(portfolioId, days)
        if (snapshots.length === 0) return []

        const sorted = [...snapshots].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        const aggregated: PortfolioSnapshot[] = []
        
        const getBucketTime = (date: Date): number => {
            const d = new Date(date)
            d.setUTCHours(0, 0, 0, 0) // Midnight UTC
            if (interval === 'weekly') {
                const day = d.getUTCDay()
                const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1) // Start on Monday
                d.setUTCDate(diff)
            } else if (interval === 'monthly') {
                d.setUTCDate(1)
            }
            return d.getTime()
        }

        const incrementBucket = (time: number): number => {
            const d = new Date(time)
            if (interval === 'daily') d.setUTCDate(d.getUTCDate() + 1)
            else if (interval === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
            else if (interval === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1)
            return d.getTime()
        }

        const startDate = new Date(sorted[0].timestamp)
        const endDate = new Date(sorted[sorted.length - 1].timestamp)
        
        let bucketTime = getBucketTime(startDate)
        const endTime = getBucketTime(endDate)

        let snapshotIndex = 0
        let lastKnownSnapshot = sorted[0]

        while (bucketTime <= endTime) {
            const nextBucketTime = incrementBucket(bucketTime)
            
            while (snapshotIndex < sorted.length) {
                const t = new Date(sorted[snapshotIndex].timestamp).getTime()
                if (t < nextBucketTime) {
                    lastKnownSnapshot = sorted[snapshotIndex]
                    snapshotIndex++
                } else {
                    break
                }
            }

            const totalValue = Math.max(0, lastKnownSnapshot.totalValue)

            aggregated.push({
                ...lastKnownSnapshot,
                totalValue,
                timestamp: new Date(bucketTime).toISOString()
            })

            bucketTime = nextBucketTime
        }

        return aggregated
    }

    calculatePerformanceMetrics(portfolioId: string): PerformanceMetrics {
        const snapshots = this.getAnalytics(portfolioId, 90)
        return this.computeMetricsFromSnapshots(snapshots)
    }

    computeMetricsFromSnapshots(snapshots: PortfolioSnapshot[]): PerformanceMetrics {
        if (snapshots.length < 2) {
            return {
                totalReturn: 0,
                dailyChange: 0,
                weeklyChange: 0,
                maxDrawdown: 0,
                bestDay: { date: '', change: 0 },
                worstDay: { date: '', change: 0 },
                sharpeRatio: 0,
                volatility: 0,
            }
        }

        const sortedSnapshots = [...snapshots].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
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
            dailyChangeData.push({ date: sortedSnapshots[i].timestamp, change })
        }

        const dailyChange = dailyChanges.length > 0 ? dailyChanges[dailyChanges.length - 1] : 0

        const weekAgoIndex = Math.max(0, sortedSnapshots.length - 7)
        const weekAgoValue = sortedSnapshots[weekAgoIndex].totalValue
        const weeklyChange = weekAgoValue > 0 ? ((finalValue - weekAgoValue) / weekAgoValue) * 100 : 0

        let maxDrawdown = 0
        let peak = initialValue
        for (const snapshot of sortedSnapshots) {
            if (snapshot.totalValue > peak) peak = snapshot.totalValue
            const drawdown = peak > 0 ? ((peak - snapshot.totalValue) / peak) * 100 : 0
            if (drawdown > maxDrawdown) maxDrawdown = drawdown
        }

        const bestDay = dailyChangeData.reduce(
            (best, curr) => (curr.change > best.change ? curr : best),
            { date: '', change: -Infinity }
        )
        const worstDay = dailyChangeData.reduce(
            (worst, curr) => (curr.change < worst.change ? curr : worst),
            { date: '', change: Infinity }
        )

        const meanChange =
            dailyChanges.length > 0
                ? dailyChanges.reduce((sum, c) => sum + c, 0) / dailyChanges.length
                : 0
        const variance =
            dailyChanges.length > 0
                ? dailyChanges.reduce((sum, c) => sum + Math.pow(c - meanChange, 2), 0) /
                dailyChanges.length
                : 0
        const volatility = Math.sqrt(variance)

        const riskFreeRate = 0.02 / 365
        const excessReturn = meanChange / 100 - riskFreeRate
        const sharpeRatio = volatility > 0 ? (excessReturn / (volatility / 100)) * Math.sqrt(365) : 0

        return {
            totalReturn,
            dailyChange,
            weeklyChange,
            maxDrawdown,
            bestDay: bestDay.change !== -Infinity ? bestDay : { date: '', change: 0 },
            worstDay: worstDay.change !== Infinity ? worstDay : { date: '', change: 0 },
            sharpeRatio,
            volatility,
        }
    }

    getPerformanceSummary(portfolioId: string) {
        const metrics = this.calculatePerformanceMetrics(portfolioId)
        const snapshots = this.getAnalytics(portfolioId, 30)

        return {
            metrics,
            dataPoints: snapshots.length,
            period: '30 days',
            lastUpdated: snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : null,
        }
    }

    /**
     * Compact analytics snapshots for a single portfolio.
     * Preserves recent high-frequency data while rolling up older data to daily snapshots.
     * 
     * @param portfolioId - Portfolio to compact
     * @param cutoffDays - Delete all snapshots older than this (default: 90)
     * @param recentDays - Keep high-frequency data for this period (default: 7)
     */
    async compactAnalyticsForPortfolio(
        portfolioId: string,
        cutoffDays: number = 90,
        recentDays: number = 7
    ): Promise<CompactionStats> {
        try {
            if (cutoffDays < recentDays) {
                throw new Error(`cutoffDays (${cutoffDays}) must be >= recentDays (${recentDays})`)
            }

            const stats = await dbCompactAnalyticsSnapshots(portfolioId, cutoffDays, recentDays)
            
            logger.info('Analytics snapshots compacted for portfolio', {
                portfolioId,
                deletedCount: stats.deletedCount,
                retainedCount: stats.retainedCount,
                cutoffDays,
                recentDays,
            })

            return stats
        } catch (error) {
            logger.error('Failed to compact analytics snapshots for portfolio', {
                portfolioId,
                error,
            })
            throw error
        }
    }

    /**
     * Compact analytics snapshots for all portfolios.
     * Called by the analytics-compaction BullMQ worker.
     */
    async compactAllPortfolios(
        cutoffDays: number = 90,
        recentDays: number = 7
    ): Promise<CompactionStats[]> {
        try {
            const portfolios = portfolioStorage.getAllPortfolios()
            const results: CompactionStats[] = []

            logger.info('Starting analytics compaction for all portfolios', {
                portfolioCount: portfolios.length,
                cutoffDays,
                recentDays,
            })

            for (const portfolio of portfolios) {
                const stats = await this.compactAnalyticsForPortfolio(
                    portfolio.id,
                    cutoffDays,
                    recentDays
                )
                results.push(stats)
            }

            const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0)
            const totalRetained = results.reduce((sum, r) => sum + r.retainedCount, 0)

            logger.info('Analytics compaction cycle complete', {
                portfoliosProcessed: results.length,
                totalSnapshotsDeleted: totalDeleted,
                totalSnapshotsRetained: totalRetained,
            })

            return results
        } catch (error) {
            logger.error('Failed to compact analytics snapshots for all portfolios', { error })
            throw error
        }
    }

    /** No-op – kept for API compatibility. Workers are stopped in index.ts. */
    stop() {
        // Nothing to clear; no setInterval is used.
    }
}

export const analyticsService = new AnalyticsService()
export type { PortfolioSnapshot, PerformanceMetrics }