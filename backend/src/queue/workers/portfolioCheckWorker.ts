import type { Job } from 'bullmq'
import { Worker } from 'bullmq'
import { portfolioStorage } from '../../services/portfolioStorage.js'
import { StellarService } from '../../services/stellar.js'
import { ReflectorService } from '../../services/reflector.js'
import { CircuitBreakers } from '../../services/circuitBreakers.js'
import { getRebalanceQueue } from '../queues.js'
import type { PortfolioCheckJobData } from '../queues.js'
import { getConnectionOptions } from '../connection.js'
import { logger } from '../../utils/logger.js'

const DEMO_PORTFOLIO_IDS = new Set(['demo', 'demo-portfolio-1'])

let worker: Worker | null = null

export async function processPortfolioCheckJob(job: Job<PortfolioCheckJobData>): Promise<void> {
    const triggeredBy = job.data.triggeredBy ?? 'scheduler'
    logger.info('[WORKER:portfolio-check] Running portfolio check cycle', {
        jobId: job.id,
        triggeredBy
    })

    const allPortfolios = await portfolioStorage.getAllPortfolios()
    const portfolios = allPortfolios.filter((p) => !DEMO_PORTFOLIO_IDS.has(p.id))

    if (portfolios.length === 0) {
        return
    }

    const reflector = new ReflectorService()
    const prices = await reflector.getCurrentPrices()
    const market = await CircuitBreakers.checkMarketConditions(prices)
    if (!market.safe) {
        logger.warn('[WORKER:portfolio-check] Skipping rebalance enqueue — market conditions unsafe', {
            jobId: job.id,
            reason: market.reason
        })
        return
    }

    const queue = getRebalanceQueue()
    if (!queue) {
        logger.warn('[WORKER:portfolio-check] Rebalance queue unavailable', { jobId: job.id })
        return
    }

    const stellarService = new StellarService()
    for (const p of portfolios) {
        const needed = await stellarService.checkRebalanceNeeded(p.id)
        if (!needed) continue

        await queue.add(
            `rebalance-${p.id}`,
            { portfolioId: p.id, triggeredBy: 'auto' as const },
            { removeOnComplete: true }
        )
    }
}

export function startPortfolioCheckWorker(): Worker | null {
    if (worker) return worker
    try {
        worker = new Worker('portfolio-check', processPortfolioCheckJob, {
            connection: getConnectionOptions(),
            concurrency: 1
        })
    } catch (err) {
        logger.warn('[WORKER:portfolio-check] Failed to start – Redis may be unavailable', {
            error: err instanceof Error ? err.message : String(err)
        })
        return null
    }

    worker.on('completed', (j) => {
        logger.info('[WORKER:portfolio-check] Job completed', { jobId: j.id })
    })

    worker.on('failed', (j, err) => {
        logger.error('[WORKER:portfolio-check] Job failed', {
            jobId: j?.id,
            error: err.message,
            attemptsMade: j?.attemptsMade
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

export function isPortfolioCheckWorkerRunning(): boolean {
    return worker !== null
}
