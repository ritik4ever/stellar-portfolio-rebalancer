import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import { StellarService } from '../../services/stellar.js'
import { ReflectorService } from '../../services/reflector.js'
import { riskManagementService } from '../../services/serviceContainer.js'
import { portfolioStorage } from '../../services/portfolioStorage.js'
import { CircuitBreakers } from '../../services/circuitBreakers.js'
import { notificationService } from '../../services/notificationService.js'
import { getRebalanceQueue } from '../queues.js'
import { logger, logAudit } from '../../utils/logger.js'
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

            // Use the stored portfolio directly for risk checks.
            // stellarService.getPortfolio() returns a UI response with allocations as an
            // array, which would corrupt weight calculations in shouldAllowRebalance.
            const storedPortfolio = portfolio  // already the stored shape from getAllPortfolios()

            // Check cooldown using last-rebalance timestamp from stored portfolio
            const cooldownCheck = CircuitBreakers.checkCooldownPeriod(storedPortfolio.lastRebalance)
            if (!cooldownCheck.safe) {
                skipped++
                continue
            }

            // Risk management — pass stored portfolio with Record<string, number> allocations
            const riskCheck = riskManagementService.shouldAllowRebalance(storedPortfolio, prices)
            if (!riskCheck.allowed) {
                logger.warn('[WORKER:portfolio-check] Rebalance blocked by risk management', {
                    portfolioId: portfolio.id,
                    reason: riskCheck.reason,
                })
                skipped++
                continue
            }

            // Concentration risk
            const concentrationCheck = CircuitBreakers.checkConcentrationRisk(storedPortfolio.allocations)
            if (!concentrationCheck.safe) {
                skipped++
                continue
            }

            // Enqueue a rebalance job for this portfolio
            if (rebalanceQueue) {
                const jobId = `rebalance-${portfolio.id}-${Date.now()}`
                await rebalanceQueue.add(
                    `rebalance-${portfolio.id}`,
                    { portfolioId: portfolio.id, triggeredBy: 'auto' },
                    { jobId }
                )
                queued++
                logger.info('[WORKER:portfolio-check] Enqueued rebalance job', {
                    portfolioId: portfolio.id,
                    jobId,
                })
                logAudit('auto_rebalance_enqueued', {
                    portfolioId: portfolio.id,
                    jobId,
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
