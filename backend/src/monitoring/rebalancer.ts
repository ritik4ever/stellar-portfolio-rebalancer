import { WebSocketServer } from 'ws'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { RebalanceHistoryService } from '../services/rebalanceHistory.js'
import { RiskManagementService } from '../services/riskManagements.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { getPortfolioCheckQueue } from '../queue/queues.js'
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

    /**
     * Start the monitoring service.
     * Recurring portfolio checks and risk metric updates are now handled by
     * the BullMQ portfolio-check worker. This method sets up WebSocket
     * broadcasting hooks only.
     *
     * NOTE: node-cron schedules have been removed – replaced by the queue
     * scheduler in src/queue/scheduler.ts.
     */
    start() {
        logger.info('[REBALANCING-SERVICE] Monitoring service started (queue-backed). WebSocket broadcasting active.')
    }

    /**
     * Manually check a specific portfolio and broadcast results via WebSocket.
     */
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

    async getStatus(): Promise<any> {
        const stats = await this.rebalanceHistoryService.getHistoryStats()
        const circuitBreakers = this.riskManagementService.getCircuitBreakerStatus()
        const active = await this.getActivePortfolios()
        return {
            activePortfolios: active.length,
            rebalanceHistory: stats,
            circuitBreakers,
            riskManagement: { enabled: true, lastUpdate: new Date().toISOString() },
        }
    }

    // ─── Internal helpers (used by forceCheckPortfolio) ──────────────────────

    private async checkPortfolioForRebalancing(portfolioId: string) {
        try {
            const prices = await this.reflectorService.getCurrentPrices()
            const portfolio = await this.stellarService.getPortfolio(portfolioId)

            const riskAlerts = this.riskManagementService.updatePriceData(prices)
            const needsRebalance = await this.stellarService.checkRebalanceNeeded(portfolioId)

            if (needsRebalance) {
                logger.info(`Portfolio ${portfolioId} needs rebalancing – enqueueing job`)
                const riskCheck = this.riskManagementService.shouldAllowRebalance(portfolio, prices)

                if (riskCheck.allowed) {
                    // Enqueue a rebalance job rather than executing inline
                    const queue = getPortfolioCheckQueue()
                    if (queue) {
                        await queue.add(
                            `manual-check-${portfolioId}`,
                            { triggeredBy: 'manual' },
                            { priority: 1 }
                        )
                        this.notifyClients(portfolioId, 'rebalance_queued', {
                            message: 'Rebalance job enqueued',
                        })
                    }
                } else {
                    logger.warn(`Rebalancing blocked for ${portfolioId}: ${riskCheck.reason}`)
                    this.notifyClients(portfolioId, 'rebalance_blocked', {
                        message: 'Rebalancing temporarily blocked by safety systems',
                        reason: riskCheck.reason,
                        alerts: riskCheck.alerts,
                    })

                    await this.rebalanceHistoryService.recordRebalanceEvent({
                        portfolioId,
                        trigger: 'Automatic Check – Blocked',
                        trades: 0,
                        gasUsed: '0 XLM',
                        status: 'failed',
                        prices,
                        portfolio,
                    })
                }
            }

            if (riskAlerts.length > 0) {
                const criticalAlerts = riskAlerts.filter((a: RiskAlert) => a.severity === 'critical')
                if (criticalAlerts.length > 0) {
                    this.notifyClients(portfolioId, 'risk_alert', {
                        message: 'Critical risk conditions detected',
                        alerts: criticalAlerts,
                    })
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error(`Failed to check portfolio ${portfolioId} for rebalancing:`, {
                error: errorMessage,
                portfolioId,
            })
        }
    }

    private async getActivePortfolios(): Promise<Array<{ id: string; autoRebalance: boolean }>> {
        const allPortfolios = await portfolioStorage.getAllPortfolios()
        return allPortfolios
            .filter((p: Portfolio) => p.threshold > 0)
            .map((p: Portfolio) => ({ id: p.id, autoRebalance: true }))
    }

    private notifyClients(portfolioId: string, event: string, data: any = {}) {
        const message = JSON.stringify({
            type: 'portfolio_update',
            portfolioId,
            event,
            data,
            timestamp: new Date().toISOString(),
        })

        this.wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(message)
        })

        logger.info(`Notification sent: ${event} for portfolio ${portfolioId}`)
    }

    private broadcastToAllClients(event: string, data: any = {}) {
        const message = JSON.stringify({
            type: 'market_update',
            event,
            data,
            timestamp: new Date().toISOString(),
        })

        this.wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(message)
        })

        logger.info(`Market broadcast sent: ${event}`)
    }
}