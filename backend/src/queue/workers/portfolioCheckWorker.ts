import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import { StellarService } from '../../services/stellar.js'
import { ReflectorService } from '../../services/reflector.js'
import { riskManagementService } from '../../services/serviceContainer.js'
import { portfolioStorage } from '../../services/portfolioStorage.js'
import { CircuitBreakers } from '../../services/circuitBreakers.js'
import { notificationService } from '../../services/notificationService.js'
import { getRebalanceQueue } from '../queues.js'
import { logger } from '../../utils/logger.js'
import type { PortfolioCheckJobData } from '../queues.js'

let worker: Worker | null = null

/**
 * Core processor: checks all portfolios for drift and enqueues rebalance jobs
 * as needed. Extracted as a standalone function so tests can call it directly.
 */
export async function processPortfolioCheckJob(
    job: Job<PortfolioCheckJobData>
): Promise<void> {
    logger.info('[WORKER:portfolio-check] Starting portfolio check cycle', {
        jobId: job.id,
        triggeredBy: job.data.triggeredBy ?? 'scheduler',
    })

    const stellarService = new StellarService()
    const reflectorService = new ReflectorService()

    const allPortfolios = await portfolioStorage.getAllPortfolios()

    if (allPortfolios.length === 0) {
        logger.info('[WORKER:portfolio-check] No portfolios to check')
        return
    }

    // Get current market prices once for all portfolios
    const prices = await reflectorService.getCurrentPrices()

    // Market-wide circuit breaker
    const marketCheck = await CircuitBreakers.checkMarketConditions(prices)
    if (!marketCheck.safe) {
        logger.warn('[WORKER:portfolio-check] Market conditions unsafe, skipping cycle', {
            reason: marketCheck.reason,
        })
        return
    }

    const rebalanceQueue = getRebalanceQueue()

    let checked = 0
    let queued = 0
    let skipped = 0

    for (const portfolio of allPortfolios) {
        try {
            checked++

            // Skip demo portfolio
            if (portfolio.id === 'demo') {
                logger.info('[WORKER:portfolio-check] Skipping demo portfolio')
                skipped++
                continue
            }

            const needsRebalance = await stellarService.checkRebalanceNeeded(portfolio.id)
            if (!needsRebalance) {
                skipped++
                continue
            }

            // Check cooldown
            const p = await stellarService.getPortfolio(portfolio.id)
            const cooldownCheck = CircuitBreakers.checkCooldownPeriod(p.lastRebalance)
            if (!cooldownCheck.safe) {
                skipped++
                continue
            }

            // Risk management
            const riskCheck = riskManagementService.shouldAllowRebalance(p, prices)
            if (!riskCheck.allowed) {
                logger.warn('[WORKER:portfolio-check] Rebalance blocked by risk management', {
                    portfolioId: portfolio.id,
                    reason: riskCheck.reason,
                })
                skipped++
                continue
            }

            // Concentration risk
            const concentrationCheck = CircuitBreakers.checkConcentrationRisk(p.allocations)
            if (!concentrationCheck.safe) {
                skipped++
                continue
            }

            // Enqueue a rebalance job for this portfolio
            if (rebalanceQueue) {
                await rebalanceQueue.add(
                    `rebalance-${portfolio.id}`,
                    { portfolioId: portfolio.id, triggeredBy: 'auto' },
                    { jobId: `rebalance-${portfolio.id}-${Date.now()}` }
                )
                queued++
                logger.info('[WORKER:portfolio-check] Enqueued rebalance job', {
                    portfolioId: portfolio.id,
                })
            }
        } catch (err) {
            logger.error('[WORKER:portfolio-check] Error checking portfolio', {
                portfolioId: portfolio.id,
                error: err instanceof Error ? err.message : String(err),
            })
            skipped++
        }
    }

    logger.info('[WORKER:portfolio-check] Cycle complete', {
        checked,
        queued,
        skipped,
    })
}

/**
 * Starts the portfolio-check BullMQ worker (singleton).
 */
export function startPortfolioCheckWorker(): Worker | null {
    if (worker) return worker

    try {
        worker = new Worker(
            'portfolio-check',
            processPortfolioCheckJob,
            {
                connection: getConnectionOptions(),
                concurrency: 1,
            }
        )
    } catch (err) {
        logger.warn('[WORKER:portfolio-check] Failed to start – Redis may be unavailable', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }

    worker.on('completed', (job) => {
        logger.info('[WORKER:portfolio-check] Job completed', { jobId: job.id })
    })

    worker.on('failed', (job, err) => {
        logger.error('[WORKER:portfolio-check] Job failed', {
            jobId: job?.id,
            error: err.message,
            attemptsMade: job?.attemptsMade,
        })
    })

    logger.info('[WORKER:portfolio-check] Worker started')
    return worker
}

export async function stopPortfolioCheckWorker(): Promise<void> {
    if (worker) {
        await worker.close()
        worker = null
        logger.info('[WORKER:portfolio-check] Worker stopped')
    }
}
