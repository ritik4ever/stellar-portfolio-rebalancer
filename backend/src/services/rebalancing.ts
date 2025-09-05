import cron from 'node-cron'
import { WebSocketServer } from 'ws'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { logger } from '../utils/logger.js'
import type { Portfolio } from '../types/index.js'

export class RebalancingService {
    private stellarService: StellarService
    private reflectorService: ReflectorService
    private wss: WebSocketServer

    constructor(wss: WebSocketServer) {
        this.stellarService = new StellarService()
        this.reflectorService = new ReflectorService()
        this.wss = wss
    }

    start() {
        cron.schedule('*/2 * * * *', async () => {
            await this.checkAllPortfolios()
        })

        logger.info('Rebalancing service started with price monitoring')
    }

    private async checkAllPortfolios() {
        try {
            const portfolios = this.getActivePortfolios()

            for (const portfolio of portfolios) {
                try {
                    const needsRebalance = await this.stellarService.checkRebalanceNeeded(portfolio.id)

                    if (needsRebalance) {
                        logger.info(`Portfolio ${portfolio.id} needs rebalancing`)
                        this.notifyClients(portfolio.id, 'rebalance_alert')
                    }
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

    private async checkRebalanceLogic(portfolioId: string): Promise<boolean> {
        try {
            return await this.stellarService.checkRebalanceNeeded(portfolioId)
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error(`Failed to check rebalance for portfolio ${portfolioId}:`, { error: errorMessage })
            return false
        }
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

    private notifyClients(portfolioId: string, event: string) {
        const message = JSON.stringify({
            type: 'portfolio_update',
            portfolioId,
            event,
            timestamp: new Date().toISOString()
        })

        this.wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(message)
            }
        })
    }
}