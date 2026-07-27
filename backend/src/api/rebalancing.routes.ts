import { Router, Request, Response } from 'express'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { rebalanceHistoryQuerySchema, recordRebalanceEventSchema, autoRebalancerControlSchema } from './validation.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { contractEventIndexerService } from '../services/contractEventIndexer.js'
import { rebalanceHistoryService, riskManagementService } from '../services/serviceContainer.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { requireAdmin } from '../middleware/auth.js'
import { adminRateLimiter } from '../middleware/rateLimit.js'
import { autoRebalancer } from '../services/runtimeServices.js'
import { ok, fail } from '../utils/apiResponse.js'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { buildReadinessReport } from '../monitoring/readiness.js'


export const rebalancingRouter = Router()

const parseOptionalTimestamp = (value: unknown): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') return undefined
    const ts = new Date(value)
    if (Number.isNaN(ts.getTime())) return undefined
    return ts.toISOString()
}

const parseHistorySource = (value: unknown): 'offchain' | 'simulated' | 'onchain' | undefined => {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().toLowerCase()
    if (normalized === 'offchain') return 'offchain'
    if (normalized === 'simulated') return 'simulated'
    if (normalized === 'onchain') return 'onchain'
    return undefined
}

const parseDryRunOptions = (body: unknown): { tradeSlippageOverrides?: Record<string, number> } => {
    const options = (body as { options?: { slippageOverrides?: Record<string, number> } } | undefined)?.options
    return {
        tradeSlippageOverrides: options?.slippageOverrides
    }
}

rebalancingRouter.get('/rebalance/history', validateQuery(rebalanceHistoryQuerySchema), async (req: Request, res: Response) => {
    try {
        const portfolioId = req.query.portfolioId as string | undefined
        const limit = (req.query.limit as unknown as number | undefined) ?? 50
        const offset = (req.query.offset as unknown as number | undefined) ?? 0
        const source = parseHistorySource(req.query.source)
        const startTimestamp = parseOptionalTimestamp(req.query.startTimestamp)
        const endTimestamp = parseOptionalTimestamp(req.query.endTimestamp)
        const syncOnChain = (req.query.syncOnChain as unknown as boolean | undefined) === true

        logger.info('Rebalance history request', { portfolioId: portfolioId || 'all', limit, offset })
        if (syncOnChain) {
            await contractEventIndexerService.syncOnce()
        }

        const history = await rebalanceHistoryService.getRebalanceHistory(
            portfolioId || undefined,
            limit,
            {
                eventSource: source,
                startTimestamp,
                endTimestamp
            },
            offset
        )

        return ok(
            res,
            {
                history,
                portfolioId: portfolioId || undefined,
                pagination: {
                    limit,
                    offset,
                    count: history.length
                },
                filters: {
                    source,
                    startTimestamp,
                    endTimestamp
                }
            },
            { meta: { count: history.length, limit, offset } }
        )

    } catch (error) {
        logger.error('[ERROR] Rebalance history failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Record new rebalance event
rebalancingRouter.post('/rebalance/history', idempotencyMiddleware, validateRequest(recordRebalanceEventSchema), async (req: Request, res: Response) => {
    try {
        const eventData = req.body

        logger.info('Recording new rebalance event', { eventData })

        const event = await rebalanceHistoryService.recordRebalanceEvent({
            ...eventData,
            isAutomatic: eventData.isAutomatic || false
        })

        return ok(res, { event })
    } catch (error) {
        logger.error('[ERROR] Failed to record rebalance event', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

rebalancingRouter.post('/rebalance/history/sync-onchain', requireAdmin, async (req: Request, res: Response) => {
    try {
        const result = await contractEventIndexerService.syncOnce()
        return ok(res, {
            ...result,
            indexer: contractEventIndexerService.getStatus()
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ================================
// REBALANCE READINESS SUMMARY
// ================================

rebalancingRouter.get('/rebalance/summary/:portfolioId', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.portfolioId
        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        logger.info('Rebalance summary request', { portfolioId })

        const stellarService = new StellarService()
        const reflectorService = new ReflectorService()

        // Fetch portfolio data
        const portfolio = await portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        }

        // Parallel fetch of all preconditions
        const [readinessReport, pricesWithMeta, portfolioDetails, needsRebalance] = await Promise.all([
            buildReadinessReport(),
            reflectorService.getCurrentPricesWithMeta(),
            stellarService.getPortfolio(portfolioId),
            stellarService.checkRebalanceNeeded(portfolioId)
        ])

        const prices = pricesWithMeta.prices
        const feedMeta = pricesWithMeta.feedMeta

        // Risk assessment
        const riskCheck = riskManagementService.shouldAllowRebalance(portfolio, prices)
        const riskMetrics = riskCheck.riskMetrics

        // Calculate drift details
        const currentAllocations: Record<string, number> = {}
        const targetAllocations = portfolio.allocations || {}
        let maxDrift = 0

        if (portfolioDetails?.allocations) {
            portfolioDetails.allocations.forEach((alloc: any) => {
                currentAllocations[alloc.asset] = alloc.current
                const target = targetAllocations[alloc.asset] || 0
                const drift = Math.abs(alloc.current - target)
                maxDrift = Math.max(maxDrift, drift)
            })
        }

        // Slippage analysis
        const slippageTolerancePercent = portfolio.slippageTolerancePercent ?? 1
        const estimatedSlippageBps = Math.round(slippageTolerancePercent * 100)

        // Data freshness
        const now = Date.now()
        const priceTimestamps = Object.values(prices).map((p: any) => p.timestamp * 1000).filter(Boolean)
        const latestPriceTime = priceTimestamps.length > 0 ? Math.max(...priceTimestamps) : now
        const dataAgeSeconds = Math.round((now - latestPriceTime) / 1000)
        const isDataStale = dataAgeSeconds > 300 // 5 minutes

        // Readiness assessment
        const systemReady = readinessReport.status === 'ready'
        const autoRebalancerStatus = autoRebalancer?.getStatus()
        const canExecute = systemReady && riskCheck.allowed && !isDataStale

        const summary = {
            portfolioId,
            timestamp: new Date().toISOString(),
            readiness: {
                systemReady,
                canExecute,
                status: readinessReport.status,
                checks: {
                    database: readinessReport.checks.database.status,
                    queue: readinessReport.checks.queue.status,
                    workers: readinessReport.checks.workers.status,
                    autoRebalancer: autoRebalancerStatus?.isRunning && autoRebalancerStatus?.initialized
                },
                details: readinessReport.checks
            },
            drift: {
                needsRebalance,
                maxDriftPercent: Number(maxDrift.toFixed(2)),
                threshold: portfolio.threshold,
                currentAllocations,
                targetAllocations,
                exceedsThreshold: maxDrift > portfolio.threshold
            },
            slippage: {
                maxSlippagePercent: slippageTolerancePercent,
                estimatedSlippageBps,
                withinTolerance: estimatedSlippageBps <= (slippageTolerancePercent * 100)
            },
            risk: {
                allowed: riskCheck.allowed,
                reason: riskCheck.reason,
                reasonCode: riskCheck.reasonCode,
                overallRiskLevel: riskMetrics.overallRiskLevel,
                alerts: riskCheck.alerts,
                metrics: {
                    volatility: Number(riskMetrics.volatility.toFixed(4)),
                    concentrationRisk: Number(riskMetrics.concentrationRisk.toFixed(4)),
                    liquidityRisk: Number(riskMetrics.liquidityRisk.toFixed(4)),
                    correlationRisk: Number(riskMetrics.correlationRisk.toFixed(4)),
                    ewmaVolatility: Number(riskMetrics.ewmaVolatility.toFixed(4)),
                    var95: Number(riskMetrics.var95.toFixed(4)),
                    cvar95: Number(riskMetrics.cvar95.toFixed(4)),
                    maxDrawdown: Number(riskMetrics.maxDrawdown.toFixed(4)),
                    drawdownBand: riskMetrics.drawdownBand,
                    sampleSize: riskMetrics.sampleSize
                },
                circuitBreakers: riskManagementService.getCircuitBreakerStatus()
            },
            dataFreshness: {
                latestPriceTimestamp: new Date(latestPriceTime).toISOString(),
                ageSeconds: dataAgeSeconds,
                isStale: isDataStale,
                feedMeta,
                priceCount: Object.keys(prices).length
            },
            recommendations: riskManagementService.getRecommendations(riskMetrics, targetAllocations)
        }

        // Log actionable insights
        if (!canExecute) {
            const blockers = []
            if (!systemReady) blockers.push('system_not_ready')
            if (!riskCheck.allowed) blockers.push(`risk_blocked:${riskCheck.reasonCode}`)
            if (isDataStale) blockers.push('stale_price_data')
            
            logger.warn('Rebalance summary: execution blocked', {
                portfolioId,
                blockers,
                needsRebalance,
                riskLevel: riskMetrics.overallRiskLevel
            })
        }

        return ok(res, summary, {
            meta: {
                canExecute,
                needsRebalance,
                riskLevel: riskMetrics.overallRiskLevel
            }
        })

    } catch (error) {
        logger.error('[ERROR] Rebalance summary failed', { 
            error: getErrorObject(error),
            portfolioId: req.params.portfolioId 
        })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ================================
// AUTO-REBALANCER ROUTES
// ================================

rebalancingRouter.get('/auto-rebalancer/status', async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return fail(res, 500, 'INTERNAL_ERROR', 'Auto-rebalancer not initialized', {
                status: { isRunning: false }
            })
        }

        const status = autoRebalancer.getStatus()
        const statistics = await autoRebalancer.getStatistics()

        return ok(res, { status, statistics })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

rebalancingRouter.post('/auto-rebalancer/start', requireAdmin, async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return fail(res, 500, 'INTERNAL_ERROR', 'Auto-rebalancer not initialized')
        }

        await autoRebalancer.start()

        return ok(res, {
            message: 'Auto-rebalancer started successfully',
            status: autoRebalancer.getStatus()
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

rebalancingRouter.post('/auto-rebalancer/stop', requireAdmin, (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return fail(res, 500, 'INTERNAL_ERROR', 'Auto-rebalancer not initialized')
        }

        autoRebalancer.stop()

        return ok(res, {
            message: 'Auto-rebalancer stopped successfully',
            status: autoRebalancer.getStatus()
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

rebalancingRouter.post('/auto-rebalancer/force-check', requireAdmin, async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return fail(res, 500, 'INTERNAL_ERROR', 'Auto-rebalancer not initialized')
        }

        await autoRebalancer.forceCheck()

        return ok(res, { message: 'Force check completed' })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

rebalancingRouter.post('/auto-rebalancer/shadow-check', requireAdmin, async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return fail(res, 500, 'INTERNAL_ERROR', 'Auto-rebalancer not initialized')
        }

        const result = await autoRebalancer.shadowCheck()
        return ok(res, { result })
    } catch (error) {
        logger.error('[ERROR] Auto-rebalancer shadow check failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

rebalancingRouter.post('/auto-rebalancer/dry-run/:portfolioId', requireAdmin, adminRateLimiter, async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return fail(res, 500, 'INTERNAL_ERROR', 'Auto-rebalancer not initialized')
        }

        const portfolioId = req.params.portfolioId
        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        const result = await autoRebalancer.dryRunPortfolioRebalance(portfolioId, parseDryRunOptions(req.body))
        return ok(res, { result })
    } catch (error) {
        const message = getErrorMessage(error)
        const normalized = message.toLowerCase()
        logger.error('[ERROR] Auto-rebalancer dry-run failed', {
            portfolioId: req.params.portfolioId,
            error: getErrorObject(error)
        })

        if (normalized.includes('not found')) {
            return fail(res, 404, 'NOT_FOUND', message)
        }

        return fail(res, 500, 'INTERNAL_ERROR', message)
    }
})

rebalancingRouter.get('/auto-rebalancer/history', requireAdmin, async (req: Request, res: Response) => {
    try {
        const portfolioId = req.query.portfolioId as string
        const limit = parseInt(req.query.limit as string) || 50

        let history
        if (portfolioId) {
            history = await rebalanceHistoryService.getRecentAutoRebalances(portfolioId, limit)
        } else {
            history = (await rebalanceHistoryService.getAllAutoRebalances(limit)).slice(0, limit)
        }

        return ok(
            res,
            {
                history,
                portfolioId: portfolioId || 'all'
            },
            { meta: { count: history.length } }
        )
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
