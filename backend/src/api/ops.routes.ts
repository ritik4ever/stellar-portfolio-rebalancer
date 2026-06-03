import { Router, Request, Response } from 'express'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import {
    riskManagementService,
    rebalanceHistoryService
} from '../services/serviceContainer.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { contractEventIndexerService } from '../services/contractEventIndexer.js'
import { autoRebalancer } from '../services/runtimeServices.js'
import { getPublicFeatureFlags, getFeatureFlags } from '../config/featureFlags.js'
import { getQueueMetrics } from '../queue/queueMetrics.js'
import { getPortfolioCheckWorkerStatus } from '../queue/workers/portfolioCheckWorker.js'
import { getRebalanceWorkerStatus } from '../queue/workers/rebalanceWorker.js'
import { getAnalyticsSnapshotWorkerStatus } from '../queue/workers/analyticsSnapshotWorker.js'
import { getPortfolioExportWorkerStatus } from '../queue/workers/portfolioExportWorker.js'
import { REBALANCE_STRATEGIES } from '../services/rebalancingStrategyService.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'
import type { Portfolio } from '../types/index.js'
import { runContractDiagnostics } from '../services/contractDiagnostics.js'
import { getFailedJobs } from '../queue/queueMetrics.js'

import { getAnomalySummary } from '../monitoring/anomalyTracker.js'
import { buildReadinessReport } from '../monitoring/readiness.js'

export const opsRouter = Router()

const stellarService = new StellarService()
const reflectorService = new ReflectorService()
const featureFlags = getFeatureFlags()
const publicFeatureFlags = getPublicFeatureFlags()

/** Lightweight JSON health for API clients and integration tests (mounted at /api/health). */
opsRouter.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    })
})

opsRouter.get('/strategies', (_req: Request, res: Response) => {
    return ok(res, { strategies: REBALANCE_STRATEGIES })
})

// ================================
// SYSTEM STATUS ROUTES
// ================================

// Get comprehensive system status
opsRouter.get('/system/status', async (req: Request, res: Response) => {
    try {
        const portfolioCount = await portfolioStorage.getPortfolioCount()
        const historyStats = await rebalanceHistoryService.getHistoryStats()
        const circuitBreakers = riskManagementService.getCircuitBreakerStatus()

        // Check API health
        let priceSourcesHealthy = false
        try {
            const payload = await reflectorService.getCurrentPricesWithMeta()
            priceSourcesHealthy = Object.keys(payload.prices).length > 0
        } catch {
            priceSourcesHealthy = false
        }

        const autoRebalancerStatus = autoRebalancer ? autoRebalancer.getStatus() : { isRunning: false }
        const autoRebalancerStats = autoRebalancer ? await autoRebalancer.getStatistics() : null
        const onChainIndexerStatus = contractEventIndexerService.getStatus()

        return ok(res, {
            system: {
                status: priceSourcesHealthy ? 'operational' : 'degraded',
                uptime: global.process.uptime(),
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            },
            portfolios: {
                total: portfolioCount,
                active: portfolioCount
            },
            rebalanceHistory: historyStats,
            riskManagement: {
                circuitBreakers,
                enabled: true,
                alertsActive: Object.values(circuitBreakers).some((cb: any) => cb.isTriggered)
            },
            anomalySummary: getAnomalySummary(),
            autoRebalancer: {
                status: autoRebalancerStatus,
                statistics: autoRebalancerStats,
                enabled: !!autoRebalancer
            },
            onChainIndexer: onChainIndexerStatus,
            services: {
                priceFeeds: priceSourcesHealthy,
                riskManagement: true,
                webSockets: true,
                autoRebalancing: autoRebalancerStatus.isRunning,
                stellarNetwork: true,
                contractEventIndexer: onChainIndexerStatus.enabled
            },
            featureFlags: publicFeatureFlags
        })
    } catch (error) {
        logger.error('[ERROR] Failed to get system status', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// GET /api/system/readiness - Detailed readiness with per-dependency latency
opsRouter.get('/system/readiness', async (_req: Request, res: Response) => {
    try {
        const report = await buildReadinessReport()
        const statusCode = report.status === 'ready' ? 200 : 503
        return res.status(statusCode).json(report)
    } catch (error) {
        logger.error('[ERROR] Failed to build readiness report', { error })
        return fail(res, 500, 'INTERNAL_ERROR', 'Failed to build readiness report')
    }
})

opsRouter.get('/indexer/cursor', (_req: Request, res: Response) => {
    try {
        const cursorInfo = contractEventIndexerService.getCursorInfo()
        const status = contractEventIndexerService.getStatus()
        return ok(res, {
            enabled: status.enabled,
            running: status.running,
            ...cursorInfo
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ================================
// QUEUE HEALTH ROUTE
// ================================

opsRouter.get('/queue/health', async (req: Request, res: Response) => {
    try {
        const metrics = await getQueueMetrics()
        const workers = {
            portfolioCheck: getPortfolioCheckWorkerStatus(),
            rebalance: getRebalanceWorkerStatus(),
            analyticsSnapshot: getAnalyticsSnapshotWorkerStatus(),
            portfolioExport: getPortfolioExportWorkerStatus(),
        }
        const payload = { ...metrics, workers }
        if (metrics.redisConnected) {
            return ok(res, payload)
        }
        return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Redis unavailable', payload)
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error), {
            redisConnected: false
        })
    }
})

opsRouter.get('/workers/health', async (_req: Request, res: Response) => {
    try {
        const summary = await getWorkerHealthSummary()
        const status = summary.unhealthy > 0 ? 503 : 200
        return res.status(status).json({
            timestamp: new Date().toISOString(),
            summary: {
                total: summary.total,
                healthy: summary.healthy,
                unhealthy: summary.unhealthy,
                idle: summary.idle,
                lagging: summary.lagging
            },
            workers: summary.workers
        })
    } catch (error) {
        logger.error('[ERROR] Failed to get worker health', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

opsRouter.get('/workers/status', async (_req: Request, res: Response) => {
    try {
        const statuses = await getAllPersistedWorkerStatuses()
        return ok(res, {
            timestamp: new Date().toISOString(),
            workers: statuses
        })
    } catch (error) {
        logger.error('[ERROR] Failed to get worker statuses', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

opsRouter.get('/queue/failed', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
        const failedJobs = await getFailedJobs(limit)
        return ok(res, failedJobs)
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

opsRouter.post('/queue/failed/:jobId/retry', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params
        const { queue: queueName } = req.body

        const queueMap: Record<string, any> = {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: getPortfolioCheckQueue(),
            [QUEUE_NAMES.REBALANCE]: getRebalanceQueue(),
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: getAnalyticsSnapshotQueue(),
            [QUEUE_NAMES.PORTFOLIO_EXPORT]: getPortfolioExportQueue(),
        }

        const queue = queueMap[queueName]
        if (!queue) {
            return fail(res, 400, 'INVALID_QUEUE', 'Invalid queue name')
        }

        const job = await queue.getJob(jobId)
        if (!job) {
            return fail(res, 404, 'JOB_NOT_FOUND', 'Job not found')
        }

        await job.retry()
        return ok(res, { message: 'Job retried', jobId, queue: queueName })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/**
 * GET /api/queue/dlq
 * Lists all jobs that have exhausted their retries and were moved to the DLQ.
 */
opsRouter.get('/queue/dlq', async (req: Request, res: Response) => {
    try {
        const dlq = getDLQQueue()
        if (!dlq) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'DLQ unavailable')
        }

        const jobs = await dlq.getJobs(['waiting', 'active', 'completed', 'failed'])
        const payload = jobs.map(job => ({
            jobId: job?.id,
            ...job?.data
        }))

        return ok(res, {
            total: payload.length,
            jobs: payload
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/**
 * POST /api/queue/dlq/:jobId/replay
 * Re-enqueues a dead-lettered job back into its original operational queue.
 */
opsRouter.post('/queue/dlq/:jobId/replay', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params
        const dlq = getDLQQueue()
        if (!dlq) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'DLQ unavailable')
        }

        const job = await dlq.getJob(jobId)
        if (!job) {
            return fail(res, 404, 'JOB_NOT_FOUND', 'Dead letter job not found')
        }

        const { originalQueue, payload } = job.data

        const queueMap: Record<string, any> = {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: getPortfolioCheckQueue(),
            [QUEUE_NAMES.REBALANCE]: getRebalanceQueue(),
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: getAnalyticsSnapshotQueue(),
        }

        const targetQueue = queueMap[originalQueue]
        if (!targetQueue) {
            return fail(res, 400, 'INVALID_QUEUE', `Original queue ${originalQueue} is not supported for replay`)
        }

        await targetQueue.add(`replay-${jobId}`, payload, {
            removeOnComplete: true,
        })

        await job.remove()

        return ok(res, {
            message: 'Job successfully replayed to original queue',
            jobId,
            targetQueue: originalQueue
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

opsRouter.post('/queue/:queueName/pause', async (req: Request, res: Response) => {
    try {
        const { queueName } = req.params
        const queue = getQueueByName(queueName)

        if (!queue) {
            return fail(res, 400, 'INVALID_QUEUE', 'Invalid queue name')
        }

        await queue.pause()

        return ok(res, { message: `Queue ${queueName} paused` })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/**
 * GET /api/queue/dlq
 * Lists all jobs that have exhausted their retries and were moved to the DLQ.
 */
opsRouter.get('/queue/dlq', async (req: Request, res: Response) => {
    try {
        const dlq = getDLQQueue()
        if (!dlq) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'DLQ unavailable')
        }

        const jobs = await dlq.getJobs(['waiting', 'active', 'completed', 'failed'])
        const payload = jobs.map(job => ({
            jobId: job?.id,
            ...job?.data
        }))

        return ok(res, {
            total: payload.length,
            jobs: payload
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/**
 * POST /api/queue/dlq/:jobId/replay
 * Re-enqueues a dead-lettered job back into its original operational queue.
 */
opsRouter.post('/queue/dlq/:jobId/replay', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params
        const dlq = getDLQQueue()
        if (!dlq) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'DLQ unavailable')
        }

        const job = await dlq.getJob(jobId)
        if (!job) {
            return fail(res, 404, 'JOB_NOT_FOUND', 'Dead letter job not found')
        }

        const { originalQueue, payload } = job.data

        const queueMap: Record<string, any> = {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: getPortfolioCheckQueue(),
            [QUEUE_NAMES.REBALANCE]: getRebalanceQueue(),
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: getAnalyticsSnapshotQueue(),
        }

        const targetQueue = queueMap[originalQueue]
        if (!targetQueue) {
            return fail(res, 400, 'INVALID_QUEUE', `Original queue ${originalQueue} is not supported for replay`)
        }

        await targetQueue.add(`replay-${jobId}`, payload, {
            removeOnComplete: true,
        })

        await job.remove()

        return ok(res, {
            message: 'Job successfully replayed to original queue',
            jobId,
            targetQueue: originalQueue
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

opsRouter.get('/contract/diagnostics', async (_req: Request, res: Response) => {
    try {
        const diagnostics = await runContractDiagnostics()
        const status = diagnostics.success ? 200 : 503
        return res.status(status).json(diagnostics)
    } catch (error) {
        logger.error('[ERROR] Contract diagnostics failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ================================
// RISK MANAGEMENT ROUTES
// ================================

opsRouter.get('/risk/metrics/:portfolioId', async (req: Request, res: Response) => {
    try {
        const { portfolioId } = req.params

        logger.info('Calculating risk metrics for portfolio', { portfolioId })

        const portfolio = await stellarService.getPortfolio(portfolioId)
        const prices = await reflectorService.getCurrentPrices()

        const allocationsRecord: Record<string, number> = {}
        if (Array.isArray(portfolio.allocations)) {
            portfolio.allocations.forEach((a: any) => {
                allocationsRecord[a.asset] = a.target
            })
        } else {
            Object.assign(allocationsRecord, portfolio.allocations)
        }
        const riskMetrics = riskManagementService.analyzePortfolioRisk(allocationsRecord, prices)
        const recommendations = riskManagementService.getRecommendations(riskMetrics, allocationsRecord)
        const circuitBreakers = riskManagementService.getCircuitBreakerStatus()

        return ok(res, {
            portfolioId,
            riskMetrics,
            recommendations,
            circuitBreakers
        })
    } catch (error) {
        logger.error('[ERROR] Failed to get risk metrics', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

opsRouter.get('/risk/check/:portfolioId', async (req: Request, res: Response) => {
    try {
        const { portfolioId } = req.params

        logger.info('Checking risk conditions for portfolio', { portfolioId })

        const portfolio = await stellarService.getPortfolio(portfolioId)
        const prices = await reflectorService.getCurrentPrices()

        const riskCheck = riskManagementService.shouldAllowRebalance(portfolio as unknown as Portfolio, prices)

        return ok(res, {
            portfolioId,
            ...riskCheck
        })
    } catch (error) {
        logger.error('[ERROR] Failed to check risk conditions', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ================================
// PRICE DATA ROUTES
// ================================

opsRouter.get('/prices', async (req: Request, res: Response) => {
    try {
        logger.info('[DEBUG] Fetching prices for frontend...')
        const payload = await reflectorService.getCurrentPricesWithMeta()

        logger.info('[DEBUG] Raw prices from service', { prices: payload.prices, feedMeta: payload.feedMeta })

        return ok(res, payload)
    } catch (error) {
        logger.error('[ERROR] Prices endpoint failed', { error: getErrorObject(error) })

        if (!featureFlags.allowFallbackPrices) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Price feeds unavailable and ALLOW_FALLBACK_PRICES is disabled')
        }

        const nowSec = Math.floor(Date.now() / 1000)
        const fallbackPrices = {
            XLM: {
                price: 0.358878,
                change: -0.60,
                timestamp: nowSec,
                source: 'fallback' as const,
                servedFromCache: false,
                serverFetchedAtMs: Date.now(),
                dataTier: 'synthetic_fallback' as const
            },
            BTC: {
                price: 111150,
                change: 0.23,
                timestamp: nowSec,
                source: 'fallback' as const,
                servedFromCache: false,
                serverFetchedAtMs: Date.now(),
                dataTier: 'synthetic_fallback' as const
            },
            ETH: {
                price: 4384.56,
                change: -0.15,
                timestamp: nowSec,
                source: 'fallback' as const,
                servedFromCache: false,
                serverFetchedAtMs: Date.now(),
                dataTier: 'synthetic_fallback' as const
            },
            USDC: {
                price: 0.999781,
                change: -0.002,
                timestamp: nowSec,
                source: 'fallback' as const,
                servedFromCache: false,
                serverFetchedAtMs: Date.now(),
                dataTier: 'synthetic_fallback' as const
            }
        }

        const withAges = reflectorService.finalizePriceMap(fallbackPrices)
        const feedMeta = reflectorService.buildFeedMeta(withAges, 'synthetic_fallback')

        logger.info('[DEBUG] Sending fallback prices', { fallbackPrices: withAges })
        return ok(res, { prices: withAges, feedMeta })
    }
})

opsRouter.get('/prices/enhanced', async (req: Request, res: Response) => {
    try {
        logger.info('[INFO] Fetching enhanced prices with risk analysis')

        const { prices, feedMeta } = await reflectorService.getCurrentPricesWithMeta()

        const riskAlerts = riskManagementService.updatePriceData(prices)

        const enhancedPrices: Record<string, any> = {}

        Object.entries(prices).forEach(([asset, data]) => {
            const priceData = data as any

            enhancedPrices[asset] = {
                ...priceData,
                riskAlerts: riskAlerts.filter((alert: any) => alert.asset === asset),
                volatilityLevel: Math.abs(priceData.change || 0) > 10 ? 'high' :
                    Math.abs(priceData.change || 0) > 5 ? 'medium' : 'low'
            }
        })

        return ok(res, {
            prices: enhancedPrices,
            riskAlerts,
            feedMeta
        })
    } catch (error) {
        logger.error('[ERROR] Failed to fetch enhanced prices', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

opsRouter.get('/market/:asset/details', async (req: Request, res: Response) => {
    try {
        const asset = req.params.asset.toUpperCase()
        const marketData = await reflectorService.getDetailedMarketData(asset)

        return ok(res, marketData)
    } catch (error) {
        logger.error('Failed to fetch detailed market data', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', 'Failed to fetch market data')
    }
})

opsRouter.get('/market/:asset/chart', async (req: Request, res: Response) => {
    try {
        const asset = req.params.asset.toUpperCase()
        const days = parseInt(req.query.days as string) || 7

        const history = await reflectorService.getPriceHistory(asset, days)

        return ok(res, {
            asset,
            data: history,
            timeframe: `${days}d`,
            dataPoints: history.length
        })
    } catch (error) {
        logger.error('Failed to fetch price chart', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', 'Failed to fetch chart data')
    }
})
