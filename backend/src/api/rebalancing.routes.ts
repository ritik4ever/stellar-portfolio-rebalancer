import { Router, Request, Response } from 'express'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { rebalanceHistoryQuerySchema } from './validation.js'
import { validateQuery } from '../middleware/validate.js'
import { contractEventIndexerService } from '../services/contractEventIndexer.js'
import { rebalanceHistoryService } from '../services/serviceContainer.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { requireAdmin } from '../middleware/auth.js'
import { adminRateLimiter } from '../middleware/rateLimit.js'
import { autoRebalancer } from '../services/runtimeServices.js'
import { ok, fail } from '../utils/apiResponse.js'

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

rebalancingRouter.get('/rebalance/history', validateQuery(rebalanceHistoryQuerySchema), async (req: Request, res: Response) => {
    try {
        const portfolioId = req.query.portfolioId as string | undefined
        const limit = (req.query.limit as unknown as number | undefined) ?? 50
        const source = parseHistorySource(req.query.source)
        const startTimestamp = parseOptionalTimestamp(req.query.startTimestamp)
        const endTimestamp = parseOptionalTimestamp(req.query.endTimestamp)
        const syncOnChain = (req.query.syncOnChain as unknown as boolean | undefined) === true

        logger.info('Rebalance history request', { portfolioId: portfolioId || 'all' })
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
            }
        )

        return ok(
            res,
            {
                history,
                portfolioId: portfolioId || undefined,
                filters: {
                    source,
                    startTimestamp,
                    endTimestamp
                }
            },
            { meta: { count: history.length } }
        )

    } catch (error) {
        logger.error('[ERROR] Rebalance history failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Record new rebalance event
rebalancingRouter.post('/rebalance/history', idempotencyMiddleware, async (req: Request, res: Response) => {
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

rebalancingRouter.post('/rebalance/history/sync-onchain', requireAdmin, adminRateLimiter, async (req: Request, res: Response) => {
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

rebalancingRouter.post('/auto-rebalancer/start', requireAdmin, adminRateLimiter, async (req: Request, res: Response) => {
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

rebalancingRouter.post('/auto-rebalancer/stop', requireAdmin, adminRateLimiter, (req: Request, res: Response) => {
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

rebalancingRouter.post('/auto-rebalancer/force-check', requireAdmin, adminRateLimiter, async (req: Request, res: Response) => {
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
