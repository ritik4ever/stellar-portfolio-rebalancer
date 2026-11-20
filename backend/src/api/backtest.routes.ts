import { Router, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { ReflectorService } from '../services/reflector.js'
import {
    BACKTEST_DISCLAIMER,
    BacktestDataError,
    BacktestRecord,
    fetchBacktestHistory,
    runBacktest,
} from '../services/backtest.js'
import { backtestStorage } from '../services/backtestStorage.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { backtestRequestSchema, listBacktestsQuerySchema } from './validation.js'
import { logger } from '../utils/logger.js'
import { getErrorObject } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const backtestRouter = Router()

const reflectorService = new ReflectorService()

/**
 * Common handler for executing a backtest price window simulation with state consistency
 * across success, failure, and concurrent work.
 */
async function executeBacktestPriceWindow(
    body: {
        portfolioId?: string
        allocations?: Record<string, number>
        threshold?: number
        days?: number
        initialValue?: number
        from?: string
        to?: string
    },
    res: Response
) {
    const { portfolioId, from, to } = body
    let allocations = body.allocations
    let threshold = body.threshold

    // Enforce concurrency control per portfolio to preserve state consistency
    if (portfolioId) {
        const lockAcquired = await backtestStorage.acquireLock(portfolioId)
        if (!lockAcquired) {
            logger.warn('[BACKTEST] Concurrency conflict — backtest already in progress', { portfolioId })
            return fail(res, 409, 'CONFLICT', 'Backtest already in progress for this portfolio')
        }

        // Auto-populate allocations and threshold from portfolio if omitted
        if (!allocations || threshold === undefined) {
            try {
                const portfolio = await portfolioStorage.getPortfolio(portfolioId)
                if (!portfolio) {
                    await backtestStorage.releaseLock(portfolioId)
                    return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
                }
                allocations = allocations ?? portfolio.allocations
                threshold = threshold ?? portfolio.threshold
            } catch (err) {
                await backtestStorage.releaseLock(portfolioId)
                logger.error('[BACKTEST] Failed to retrieve portfolio', { portfolioId, error: getErrorObject(err) })
                return fail(res, 500, 'INTERNAL_ERROR', 'Failed to retrieve portfolio for backtest')
            }
        }
    }

    if (!allocations || threshold === undefined) {
        if (portfolioId) await backtestStorage.releaseLock(portfolioId)
        return fail(res, 422, 'VALIDATION_ERROR', 'Allocations and threshold are required')
    }

    const recordId = `bt_${randomUUID()}`
    const evaluatedDays = body.days ?? 90
    const startInitialValue = body.initialValue ?? 10_000

    // Persist initial record in 'running' state to preserve audit trail
    const record: BacktestRecord = {
        id: recordId,
        portfolioId,
        allocations,
        threshold,
        initialValue: startInitialValue,
        days: evaluatedDays,
        from,
        to,
        status: 'running',
        hasLeapDay: false,
        leapDayIncluded: false,
        includedDays: [],
        absentDayReasons: {},
        absentDays: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }
    await backtestStorage.saveRecord(record)

    try {
        const history = await fetchBacktestHistory(
            reflectorService,
            Object.keys(allocations),
            evaluatedDays,
            undefined,
            { from, to },
        )

        const result = runBacktest({
            allocations,
            threshold,
            initialValue: startInitialValue,
            history,
            windowStart: from ? Math.floor(new Date(from).getTime() / 1000) : undefined,
            windowEnd: to ? Math.floor(new Date(to).getTime() / 1000) : undefined,
        })

        // Persist completed record: exact agreement between persisted record and visible result
        await backtestStorage.updateRecord(recordId, {
            status: 'completed',
            startDate: result.startDate,
            endDate: result.endDate,
            startTimestamp: result.startTimestamp,
            endTimestamp: result.endTimestamp,
            hasLeapDay: result.decision.hasLeapDay,
            leapDayIncluded: result.decision.leapDayIncluded,
            includedDays: result.includedDays,
            absentDayReasons: result.absentDayReasons,
            absentDays: result.absentDays,
            decision: result.decision,
            events: result.events,
            result: {
                days: result.days,
                initialValue: result.initialValue,
                finalValue: result.finalValue,
                totalReturnPct: result.totalReturnPct,
                buyAndHoldFinalValue: result.buyAndHoldFinalValue,
                buyAndHoldReturnPct: result.buyAndHoldReturnPct,
                rebalanceCount: result.rebalanceCount,
                maxDrawdownPct: result.maxDrawdownPct,
                maxDriftObservedPct: result.maxDriftObservedPct,
            },
            error: undefined,
            updatedAt: new Date().toISOString(),
        })

        return ok(res, {
            id: recordId,
            status: 'completed',
            hasLeapDay: result.decision.hasLeapDay,
            leapDayIncluded: result.decision.leapDayIncluded,
            ...result,
            simulated: true,
            dataSource: 'coingecko_market_chart',
            disclaimer: BACKTEST_DISCLAIMER,
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const isDataError = error instanceof BacktestDataError
        const statusCode = isDataError ? 503 : 500
        const errorCode = isDataError ? 'HISTORICAL_DATA_UNAVAILABLE' : 'INTERNAL_ERROR'

        // Persist failed record: preserve state consistency on error or interruption
        await backtestStorage.updateRecord(recordId, {
            status: 'failed',
            error: errorMessage,
            updatedAt: new Date().toISOString(),
        })

        if (isDataError) {
            logger.warn('[BACKTEST] Historical data unavailable', {
                recordId,
                error: getErrorObject(error),
                cause: getErrorObject((error as BacktestDataError).cause),
            })
        } else {
            logger.error('[BACKTEST] Simulation failed', { recordId, error: getErrorObject(error) })
        }

        return fail(res, statusCode, errorCode, errorMessage, {
            recordId,
            status: 'failed',
        })
    } finally {
        if (portfolioId) {
            await backtestStorage.releaseLock(portfolioId)
        }
    }
}

// POST /api/v1/backtest and POST /api/backtest
backtestRouter.post('/backtest', validateRequest(backtestRequestSchema), async (req: Request, res: Response) => {
    return executeBacktestPriceWindow(req.body, res)
})

// GET /api/v1/backtest/:id and GET /api/backtest/:id
backtestRouter.get('/backtest/:id', async (req: Request, res: Response) => {
    const record = await backtestStorage.getRecord(req.params.id as string)
    if (!record) {
        return fail(res, 404, 'NOT_FOUND', 'Backtest record not found')
    }
    return ok(res, record)
})

// GET /api/v1/backtest and GET /api/backtest
backtestRouter.get('/backtest', validateQuery(listBacktestsQuerySchema), async (req: Request, res: Response) => {
    const portfolioId = typeof req.query.portfolioId === 'string' ? req.query.portfolioId : undefined
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const limit = typeof req.query.limit === 'number'
        ? req.query.limit
        : (typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50)
    const offset = typeof req.query.offset === 'number'
        ? req.query.offset
        : (typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0)

    const records = await backtestStorage.listRecords({ portfolioId, status, limit, offset })
    return ok(res, { records, count: records.length, limit, offset })
})

// POST /api/portfolio/:id/backtest and POST /api/v1/portfolio/:id/backtest
backtestRouter.post(
    '/portfolio/:id/backtest',
    (req: Request, _res: Response, next) => {
        req.body = req.body ?? {}
        if (!req.body.portfolioId && req.params.id) {
            req.body.portfolioId = req.params.id as string
        }
        next()
    },
    validateRequest(backtestRequestSchema),
    async (req: Request, res: Response) => {
        return executeBacktestPriceWindow({
            ...req.body,
            portfolioId: req.params.id as string,
        }, res)
    }
)

// GET /api/portfolio/:id/backtests, /api/portfolio/:id/backtest, and v1 counterparts
backtestRouter.get(
    ['/portfolio/:id/backtests', '/portfolio/:id/backtest'],
    validateQuery(listBacktestsQuerySchema),
    async (req: Request, res: Response) => {
        const limit = typeof req.query.limit === 'number'
            ? req.query.limit
            : (typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50)
        const offset = typeof req.query.offset === 'number'
            ? req.query.offset
            : (typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0)

        const records = await backtestStorage.listRecords({ portfolioId: req.params.id as string, limit, offset })
        return ok(res, { records, count: records.length, limit, offset })
    }
)
