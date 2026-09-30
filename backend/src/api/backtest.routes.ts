import { Router, Request, Response } from 'express'
import { ReflectorService } from '../services/reflector.js'
import {
    BACKTEST_DISCLAIMER,
    BacktestDataError,
    fetchBacktestHistory,
    runBacktest,
} from '../services/backtest.js'
import { validateRequest } from '../middleware/validate.js'
import { backtestRequestSchema } from './validation.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const backtestRouter = Router()

const reflectorService = new ReflectorService()

backtestRouter.post('/backtest', validateRequest(backtestRequestSchema), async (req: Request, res: Response) => {
    const { allocations, threshold, days, initialValue } = req.body as {
        allocations: Record<string, number>
        threshold: number
        days: number
        initialValue: number
    }

    try {
        const history = await fetchBacktestHistory(reflectorService, Object.keys(allocations), days)
        const result = runBacktest({ allocations, threshold, initialValue, history })
        return ok(res, {
            ...result,
            simulated: true,
            dataSource: 'coingecko_market_chart',
            disclaimer: BACKTEST_DISCLAIMER,
        })
    } catch (error) {
        if (error instanceof BacktestDataError) {
            return fail(res, 503, 'HISTORICAL_DATA_UNAVAILABLE', error.message)
        }
        logger.error('[BACKTEST] Simulation failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
