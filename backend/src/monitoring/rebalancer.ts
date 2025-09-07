import cron from 'node-cron'
import { WebSocketServer } from 'ws'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { RebalanceHistoryService } from '../services/rebalanceHistory.js'
import { RiskManagementService } from '../services/riskManagements.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { logger } from '../utils/logger.js'
import type { Portfolio, RiskAlert } from '../types/index.js'

export class RebalancingService {
    private stellarService: StellarService
    private reflectorService: ReflectorService
    private rebalanceHistoryService: RebalanceHistoryService
    private riskManagementService: RiskManagementService
    private wss: WebSocketServer

    constructor(wss: WebSocketServer) {
        this.stellarService = new StellarService()
        this.reflectorService = new ReflectorService()
        this.rebalanceHistoryService = new RebalanceHistoryService()
        this.riskManagementService = new RiskManagementService()
        this.wss = wss
    }

    start() {
        // Check portfolios every 2 minutes for rebalancing needs
        cron.schedule('*/30 * * * *', async () => {
            await this.checkAllPortfolios()
        })

        // Update risk metrics every 30 seconds
        cron.schedule('*/15 * * * *', async () => {
            await this.updateRiskMetrics()
        })

        // Clean up old data every hour
        cron.schedule('0 * * * *', async () => {
            await this.performMaintenance()
        })

        logger.info('Enhanced rebalancing service started with risk management and automated monitoring')
    }

    private async checkAllPortfolios() {
        try {
            const portfolios = this.getActivePortfolios()
            console.log(`[INFO] Monitoring ${portfolios.length} active portfolios`)

            for (const portfolio of portfolios) {
                try {
                    await this.checkPortfolioForRebalancing(portfolio.id)
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error)
                    logger.error(`Error checking portfolio ${portfolio.id}:`, { error: errorMessage })
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Error in portfolio monitoring:', { error: errorMessage })
        }
    }

    private async checkPortfolioForRebalancing(portfolioId: string) {
        try {
            // Get current prices and portfolio state
            const prices = await this.reflectorService.getCurrentPrices()
            const portfolio = await this.stellarService.getPortfolio(portfolioId)

            // Update risk management with latest price data
            const riskAlerts = this.riskManagementService.updatePriceData(prices)

            // Check if rebalancing is needed
            const needsRebalance = await this.stellarService.checkRebalanceNeeded(portfolioId)

            if (needsRebalance) {
                logger.info(`Portfolio ${portfolioId} needs rebalancing`)

                // Check if rebalancing is allowed by risk management
                const riskCheck = this.riskManagementService.shouldAllowRebalance(portfolio, prices)

                if (riskCheck.allowed) {
                    // Auto-execute rebalance if enabled and safe
                    if (this.shouldAutoRebalance(portfolio, riskAlerts)) {
                        logger.info(`Auto-executing rebalance for portfolio ${portfolioId}`)
                        try {
                            await this.stellarService.executeRebalance(portfolioId)

                            this.notifyClients(portfolioId, 'rebalance_completed', {
                                message: 'Automatic rebalancing completed successfully',
                                riskLevel: 'low'
                            })
                        } catch (rebalanceError) {
                            logger.error(`Auto-rebalance failed for ${portfolioId}:`, rebalanceError)

                            this.notifyClients(portfolioId, 'rebalance_failed', {
                                message: 'Automatic rebalancing failed',
                                error: rebalanceError instanceof Error ? rebalanceError.message : String(rebalanceError)
                            })
                        }
                    } else {
                        // Notify user that manual intervention is needed
                        this.notifyClients(portfolioId, 'rebalance_alert', {
                            message: 'Portfolio needs rebalancing - manual review recommended',
                            riskAlerts: riskAlerts.filter((alert: RiskAlert) => alert.severity === 'critical')
                        })
                    }
                } else {
                    // Rebalancing blocked by risk management
                    logger.warn(`Rebalancing blocked for ${portfolioId}: ${riskCheck.reason}`)

                    this.notifyClients(portfolioId, 'rebalance_blocked', {
                        message: 'Rebalancing temporarily blocked by safety systems',
                        reason: riskCheck.reason,
                        alerts: riskCheck.alerts
                    })

                    // Record the blocked attempt
                    await this.rebalanceHistoryService.recordRebalanceEvent({
                        portfolioId,
                        trigger: 'Automatic Check - Blocked',
                        trades: 0,
                        gasUsed: '0 XLM',
                        status: 'failed',
                        prices,
                        portfolio
                    })
                }
            }

            // Send risk alerts if any
            if (riskAlerts.length > 0) {
                const criticalAlerts = riskAlerts.filter((alert: RiskAlert) => alert.severity === 'critical')
                if (criticalAlerts.length > 0) {
                    this.notifyClients(portfolioId, 'risk_alert', {
                        message: 'Critical risk conditions detected',
                        alerts: criticalAlerts
                    })
                }
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error(`Failed to check portfolio ${portfolioId} for rebalancing:`, {
                error: errorMessage,
                portfolioId
            })
        }
    }

    private async updateRiskMetrics() {
        try {
            const prices = await this.reflectorService.getCurrentPrices()
            const riskAlerts = this.riskManagementService.updatePriceData(prices)

            // Broadcast market-wide risk alerts
            if (riskAlerts.length > 0) {
                const criticalAlerts = riskAlerts.filter((alert: RiskAlert) => alert.severity === 'critical')
                if (criticalAlerts.length > 0) {
                    this.broadcastToAllClients('market_risk_alert', {
                        message: 'Critical market conditions detected',
                        alerts: criticalAlerts,
                        circuitBreakers: this.riskManagementService.getCircuitBreakerStatus()
                    })
                }
            }
        } catch (error) {
            logger.error('Failed to update risk metrics:', error)
        }
    }

    private async performMaintenance() {
        try {
            // Log system health
            const stats = this.rebalanceHistoryService.getHistoryStats()
            logger.info('System maintenance completed', {
                totalEvents: stats.totalEvents,
                portfolios: stats.portfolios,
                recentActivity: stats.recentActivity
            })
        } catch (error) {
            logger.error('Maintenance failed:', error)
        }
    }

    private shouldAutoRebalance(portfolio: any, riskAlerts: RiskAlert[]): boolean {
        // Don't auto-rebalance if there are critical risk alerts
        const criticalAlerts = riskAlerts.filter((alert: RiskAlert) => alert.severity === 'critical')
        if (criticalAlerts.length > 0) {
            return false
        }

        // Don't auto-rebalance high-value portfolios without manual oversight
        if (portfolio.totalValue > 50000) {
            return false
        }

        // Don't auto-rebalance if recent rebalance failed
        const lastRebalance = new Date(portfolio.lastRebalance).getTime()
        const now = Date.now()
        const hoursSinceLastRebalance = (now - lastRebalance) / (1000 * 60 * 60)

        // Wait at least 4 hours between automatic rebalances
        if (hoursSinceLastRebalance < 4) {
            return false
        }

        return true // Safe to auto-rebalance
    }

    private getActivePortfolios(): Array<{ id: string, autoRebalance: boolean }> {
        const allPortfolios = Array.from((portfolioStorage as any).portfolios.values()) as Portfolio[]
        return allPortfolios
            .filter((p: Portfolio) => p.threshold > 0)
            .map((p: Portfolio) => ({
                id: p.id,
                autoRebalance: true
            }))
    }

    private notifyClients(portfolioId: string, event: string, data: any = {}) {
        const message = JSON.stringify({
            type: 'portfolio_update',
            portfolioId,
            event,
            data,
            timestamp: new Date().toISOString()
        })

        this.wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(message)
            }
        })

        logger.info(`Notification sent: ${event} for portfolio ${portfolioId}`)
    }

    private broadcastToAllClients(event: string, data: any = {}) {
        const message = JSON.stringify({
            type: 'market_update',
            event,
            data,
            timestamp: new Date().toISOString()
        })

        this.wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(message)
            }
        })

        logger.info(`Market broadcast sent: ${event}`)
    }

    // Public method to force check a specific portfolio
    async forceCheckPortfolio(portfolioId: string): Promise<any> {
        try {
            await this.checkPortfolioForRebalancing(portfolioId)
            return { success: true, message: 'Portfolio check completed' }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error(`Force check failed for portfolio ${portfolioId}:`, { error: errorMessage })
            return { success: false, error: errorMessage }
        }
    }

    // Get service status
    getStatus(): any {
        const stats = this.rebalanceHistoryService.getHistoryStats()
        const circuitBreakers = this.riskManagementService.getCircuitBreakerStatus()

        return {
            activePortfolios: this.getActivePortfolios().length,
            rebalanceHistory: stats,
            circuitBreakers,
            riskManagement: {
                enabled: true,
                lastUpdate: new Date().toISOString()
            }
        }
    }
}