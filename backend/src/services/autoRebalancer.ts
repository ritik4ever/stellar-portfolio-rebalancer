import { StellarService } from './stellar.js'
import { ReflectorService } from './reflector.js'
import { rebalanceHistoryService } from './serviceContainer.js'
import { portfolioStorage } from './portfolioStorage.js'
import { CircuitBreakers } from './circuitBreakers.js'
import { notificationService } from './notificationService.js'
import { logger, logAudit } from '../utils/logger.js'
import { getPortfolioCheckQueue } from '../queue/queues.js'
import { isRedisAvailable } from '../queue/connection.js'

export class AutoRebalancerService {
    private stellarService: StellarService
    private reflectorService: ReflectorService
    private isRunning = false

    // Configuration (kept for getStatus() compatibility)
    private readonly CHECK_INTERVAL = 30 * 60 * 1000        // 30 minutes
    private readonly MIN_REBALANCE_INTERVAL = 24 * 60 * 60 * 1000
    private readonly MAX_AUTO_REBALANCES_PER_DAY = 3

    constructor() {
        this.stellarService = new StellarService()
        this.reflectorService = new ReflectorService()
    }

    /**
     * Start the automatic monitoring service.
     * With BullMQ, this just flags the service as running – the scheduler
     * already registered the repeatable job. We also enqueue an immediate
     * check so the first run happens without waiting 30 min.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('[AUTO-REBALANCER] Already running')
            return
        }

        this.isRunning = true
        logger.info('[AUTO-REBALANCER] Service started (queue-backed)')
        logAudit('auto_rebalancer_started', { backend: 'bullmq' })

        const redisUp = await isRedisAvailable()
        if (redisUp) {
            const queue = getPortfolioCheckQueue()
            if (queue) {
                await queue.add(
                    'startup-portfolio-check',
                    { triggeredBy: 'startup' },
                    { priority: 1 }
                )
                logger.info('[AUTO-REBALANCER] Enqueued startup portfolio-check job')
            }
        } else {
            logger.warn('[AUTO-REBALANCER] Redis not available – startup check skipped')
        }
    }

    /**
     * Stop the service flag (workers are stopped separately by index.ts).
     */
    stop(): void {
        if (!this.isRunning) return
        this.isRunning = false
        logger.info('[AUTO-REBALANCER] Service stopped')
        logAudit('auto_rebalancer_stopped', { backend: 'bullmq' })
    }

    /**
     * Force an immediate check of all portfolios.
     */
    async forceCheck(): Promise<void> {
        const queue = getPortfolioCheckQueue()
        if (!queue) throw new Error('Redis unavailable – cannot force check')

        await queue.add(
            'force-portfolio-check',
            { triggeredBy: 'manual' },
            { priority: 1 }
        )
        logger.info('[AUTO-REBALANCER] Force check job enqueued')
        logAudit('auto_rebalancer_force_check_enqueued', { backend: 'bullmq' })
    }

    /**
     * Get service status
     */
    getStatus(): {
        isRunning: boolean
        checkInterval: number
        minRebalanceInterval: number
        maxRebalancesPerDay: number
        backend: string
    } {
        return {
            isRunning: this.isRunning,
            checkInterval: this.CHECK_INTERVAL,
            minRebalanceInterval: this.MIN_REBALANCE_INTERVAL,
            maxRebalancesPerDay: this.MAX_AUTO_REBALANCES_PER_DAY,
            backend: 'bullmq',
        }
    }

    /**
     * Get statistics about auto-rebalancing activity
     */
    async getStatistics(): Promise<{
        totalAutoRebalances: number
        rebalancesToday: number
        lastCheckTime: string | null
        averageRebalancesPerDay: number
    }> {
        try {
            const allAutoRebalances = await rebalanceHistoryService.getAllAutoRebalances()

            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const todayRebalances = allAutoRebalances.filter(
                r => new Date(r.timestamp) >= today
            )

            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            const recentRebalances = allAutoRebalances.filter(
                r => new Date(r.timestamp) >= thirtyDaysAgo
            )

            return {
                totalAutoRebalances: allAutoRebalances.length,
                rebalancesToday: todayRebalances.length,
                lastCheckTime: new Date().toISOString(),
                averageRebalancesPerDay: recentRebalances.length / 30,
            }
        } catch (error) {
            logger.error('[AUTO-REBALANCER] Error getting statistics', { error })
            return {
                totalAutoRebalances: 0,
                rebalancesToday: 0,
                lastCheckTime: null,
                averageRebalancesPerDay: 0,
            }
        }
    }
}
