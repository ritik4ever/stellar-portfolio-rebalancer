import { StellarService } from './stellar.js'
import { ReflectorService } from './reflector.js'
import { RebalanceHistoryService } from './rebalanceHistory.js'
import { RiskManagementService } from './riskManagements.js'
import { portfolioStorage } from './portfolioStorage.js'
import { CircuitBreakers } from './circuitBreakers.js'
import { logger } from '../utils/logger.js'

export class AutoRebalancerService {
    private stellarService: StellarService
    private reflectorService: ReflectorService
    private rebalanceHistoryService: RebalanceHistoryService
    private riskManagementService: RiskManagementService
    private isRunning = false
    private intervalId: NodeJS.Timeout | null = null

    // Configuration
    private readonly CHECK_INTERVAL = 60 * 60 * 1000 // 1 hour in milliseconds
    private readonly MIN_REBALANCE_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours minimum between rebalances
    private readonly MAX_AUTO_REBALANCES_PER_DAY = 3

    constructor() {
        this.stellarService = new StellarService()
        this.reflectorService = new ReflectorService()
        this.rebalanceHistoryService = new RebalanceHistoryService()
        this.riskManagementService = new RiskManagementService()
    }

    /**
     * Start the automatic monitoring service
     */
    start(): void {
        if (this.isRunning) {
            logger.warn('Auto-rebalancer already running')
            return
        }

        logger.info('Starting automatic portfolio rebalancer service', {
            checkInterval: this.CHECK_INTERVAL / 1000 / 60, // minutes
            minRebalanceInterval: this.MIN_REBALANCE_INTERVAL / 1000 / 60 / 60, // hours
            maxRebalancesPerDay: this.MAX_AUTO_REBALANCES_PER_DAY
        })

        this.isRunning = true

        // Run initial check
        this.checkAllPortfolios()

        // Set up periodic checks
        this.intervalId = setInterval(() => {
            this.checkAllPortfolios()
        }, this.CHECK_INTERVAL)
    }

    /**
     * Stop the automatic monitoring service
     */
    stop(): void {
        if (!this.isRunning) {
            return
        }

        logger.info('Stopping automatic portfolio rebalancer service')
        this.isRunning = false

        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }
    }

    /**
      * Check all portfolios and execute rebalancing if needed
      */
    private async checkAllPortfolios(): Promise<void> {
        try {
            logger.info('[AUTO-REBALANCER] Starting portfolio check cycle')

            // Get all portfolios
            const allPortfolios = portfolioStorage.getAllPortfolios()

            if (allPortfolios.length === 0) {
                logger.info('[AUTO-REBALANCER] No portfolios to check')
                return
            }

            // Get current market prices
            const prices = await this.reflectorService.getCurrentPrices()

            // Check if market conditions allow rebalancing
            const marketCheck = await CircuitBreakers.checkMarketConditions(prices)
            if (!marketCheck.safe) {
                logger.warn('[AUTO-REBALANCER] Market conditions unsafe, skipping rebalancing', {
                    reason: marketCheck.reason
                })
                return
            }

            let checkedCount = 0
            let rebalancedCount = 0
            let skippedCount = 0

            // Check each portfolio
            for (const portfolio of allPortfolios) {
                try {
                    checkedCount++

                    const result = await this.checkAndRebalancePortfolio(portfolio.id, prices)

                    if (result.rebalanced) {
                        rebalancedCount++
                        logger.info('[AUTO-REBALANCER] Portfolio rebalanced', {
                            portfolioId: portfolio.id,
                            reason: result.reason
                        })
                    } else {
                        skippedCount++
                        logger.info('[AUTO-REBALANCER] Portfolio skipped', {
                            portfolioId: portfolio.id,
                            reason: result.reason
                        })
                    }
                } catch (error) {
                    logger.error('[AUTO-REBALANCER] Error checking portfolio', {
                        portfolioId: portfolio.id,
                        error: error instanceof Error ? error.message : String(error)
                    })
                    skippedCount++
                }
            }

            logger.info('[AUTO-REBALANCER] Portfolio check cycle completed', {
                totalPortfolios: allPortfolios.length,
                checked: checkedCount,
                rebalanced: rebalancedCount,
                skipped: skippedCount
            })

        } catch (error) {
            logger.error('[AUTO-REBALANCER] Error in check cycle', {
                error: error instanceof Error ? error.message : String(error)
            })
        }
    }

    /**
     * Check individual portfolio and rebalance if needed
     */
    private async checkAndRebalancePortfolio(portfolioId: string, prices: any): Promise<{
        rebalanced: boolean
        reason: string
    }> {
        try {
            // Get portfolio data
            const portfolio = await this.stellarService.getPortfolio(portfolioId)

            // Skip demo portfolios in production
            if (portfolio.id === 'demo') {
                return { rebalanced: false, reason: 'Demo portfolio skipped' }
            }

            // Check if rebalancing is needed based on drift
            const needsRebalance = await this.stellarService.checkRebalanceNeeded(portfolioId)
            if (!needsRebalance) {
                return { rebalanced: false, reason: 'No rebalancing needed - within thresholds' }
            }

            // Check cooldown period
            const cooldownCheck = CircuitBreakers.checkCooldownPeriod(portfolio.lastRebalance)
            if (!cooldownCheck.safe) {
                return { rebalanced: false, reason: 'Cooldown period active' }
            }

            // Check minimum time between auto-rebalances
            if (this.isRecentlyAutoRebalanced(portfolioId)) {
                return { rebalanced: false, reason: 'Recently auto-rebalanced' }
            }

            // Check daily rebalance limit
            if (this.hasExceededDailyLimit(portfolioId)) {
                return { rebalanced: false, reason: 'Daily auto-rebalance limit exceeded' }
            }

            // Risk management checks
            const riskCheck = this.riskManagementService.shouldAllowRebalance(portfolio, prices)
            if (!riskCheck.allowed) {
                return { rebalanced: false, reason: `Risk management: ${riskCheck.reason}` }
            }

            // Concentration risk check
            const concentrationCheck = CircuitBreakers.checkConcentrationRisk(portfolio.allocations)
            if (!concentrationCheck.safe) {
                return { rebalanced: false, reason: 'Concentration risk too high' }
            }

            // All checks passed - execute rebalancing
            logger.info('[AUTO-REBALANCER] Executing automatic rebalance', {
                portfolioId,
                portfolioValue: portfolio.totalValue,
                trigger: 'automatic_drift_detection'
            })

            const rebalanceResult = await this.stellarService.executeRebalance(portfolioId)

            // Record the auto-rebalance event
            await this.rebalanceHistoryService.recordRebalanceEvent({
                portfolioId,
                trigger: 'Automatic Rebalancing',
                trades: rebalanceResult.trades || 0,
                gasUsed: rebalanceResult.gasUsed || '0 XLM',
                status: 'completed',
                isAutomatic: true,
                riskAlerts: riskCheck.alerts || []
            })

            return { rebalanced: true, reason: 'Successfully auto-rebalanced' }

        } catch (error) {
            logger.error('[AUTO-REBALANCER] Error executing rebalance', {
                portfolioId,
                error: error instanceof Error ? error.message : String(error)
            })

            // Record failed auto-rebalance
            await this.rebalanceHistoryService.recordRebalanceEvent({
                portfolioId,
                trigger: 'Automatic Rebalancing (Failed)',
                trades: 0,
                gasUsed: '0 XLM',
                status: 'failed',
                isAutomatic: true,
                error: error instanceof Error ? error.message : String(error)
            })

            throw error
        }
    }

    /**
     * Check if portfolio was recently auto-rebalanced
     */
    private isRecentlyAutoRebalanced(portfolioId: string): boolean {
        try {
            const recentHistory = this.rebalanceHistoryService.getRecentAutoRebalances(portfolioId, 1)

            if (recentHistory.length === 0) {
                return false
            }

            const lastAutoRebalance = recentHistory[0]
            const timeSinceLastRebalance = Date.now() - new Date(lastAutoRebalance.timestamp).getTime()

            return timeSinceLastRebalance < this.MIN_REBALANCE_INTERVAL
        } catch (error) {
            logger.error('Error checking recent auto-rebalances', { portfolioId, error })
            return false // Err on side of caution
        }
    }

    /**
     * Check if portfolio has exceeded daily auto-rebalance limit
     */
    private hasExceededDailyLimit(portfolioId: string): boolean {
        try {
            const today = new Date()
            today.setHours(0, 0, 0, 0)

            const todayRebalances = this.rebalanceHistoryService.getAutoRebalancesSince(portfolioId, today)

            return todayRebalances.length >= this.MAX_AUTO_REBALANCES_PER_DAY
        } catch (error) {
            logger.error('Error checking daily rebalance limit', { portfolioId, error })
            return true // Err on side of caution
        }
    }

    /**
     * Get service status
     */
    getStatus(): {
        isRunning: boolean
        checkInterval: number
        minRebalanceInterval: number
        maxRebalancesPerDay: number
        nextCheckIn?: number
    } {
        const status = {
            isRunning: this.isRunning,
            checkInterval: this.CHECK_INTERVAL,
            minRebalanceInterval: this.MIN_REBALANCE_INTERVAL,
            maxRebalancesPerDay: this.MAX_AUTO_REBALANCES_PER_DAY
        }

        return status
    }

    /**
     * Force an immediate check of all portfolios (for testing/manual trigger)
     */
    async forceCheck(): Promise<void> {
        if (!this.isRunning) {
            throw new Error('Auto-rebalancer service is not running')
        }

        logger.info('[AUTO-REBALANCER] Force check triggered')
        await this.checkAllPortfolios()
    }

    /**
     * Get statistics about auto-rebalancing activity
     */
    getStatistics(): {
        totalAutoRebalances: number
        rebalancesToday: number
        lastCheckTime: string | null
        averageRebalancesPerDay: number
    } {
        try {
            const allAutoRebalances = this.rebalanceHistoryService.getAllAutoRebalances()

            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const todayRebalances = allAutoRebalances.filter(
                rebalance => new Date(rebalance.timestamp) >= today
            )

            // Calculate average per day over last 30 days
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            const recentRebalances = allAutoRebalances.filter(
                rebalance => new Date(rebalance.timestamp) >= thirtyDaysAgo
            )

            return {
                totalAutoRebalances: allAutoRebalances.length,
                rebalancesToday: todayRebalances.length,
                lastCheckTime: new Date().toISOString(),
                averageRebalancesPerDay: recentRebalances.length / 30
            }
        } catch (error) {
            logger.error('Error getting auto-rebalancer statistics', { error })
            return {
                totalAutoRebalances: 0,
                rebalancesToday: 0,
                lastCheckTime: null,
                averageRebalancesPerDay: 0
            }
        }
    }
}