import { Router, Request, Response } from 'express'
import { StellarService } from '../services/stellar.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { analyticsService } from '../services/analyticsService.js'
import { ReflectorService } from '../services/reflector.js'
import { riskManagementService } from '../services/serviceContainer.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const analyticsRouter = Router()

const stellarService = new StellarService()
const reflectorService = new ReflectorService()

analyticsRouter.get('/portfolio/:id/analytics', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        const from = req.query.from as string | undefined
        const to = req.query.to as string | undefined
        const days = parseInt(req.query.days as string) || undefined

        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        const portfolio = portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        }

        let snapshots
        if (from && to) {
            const fromDate = new Date(from)
            const toDate = new Date(to)

            if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
                return fail(res, 400, 'VALIDATION_ERROR', 'Invalid date format. Use ISO 8601 (e.g. 2025-01-01T00:00:00Z)')
            }

            const now = new Date()
            if (fromDate > now || toDate > now) {
                return fail(res, 400, 'VALIDATION_ERROR', 'Future dates are not accepted')
            }

            if (fromDate > toDate) {
                return fail(res, 400, 'VALIDATION_ERROR', 'from date must be before to date')
            }

            snapshots = analyticsService.getAnalyticsInRange(portfolioId, from, to)
        } else {
            snapshots = analyticsService.getAnalytics(portfolioId, days || 30)
        }

        if (snapshots.length === 0) {
            return ok(res, {
                portfolioId,
                dailyValues: [],
                metrics: {
                    totalReturnPercent: 0,
                    maxDrawdownPercent: 0,
                    sharpeRatio: 0
                },
                dataPoints: 0
            })
        }

        const dailyValues = snapshots.map(s => ({
            timestamp: s.timestamp,
            totalValue: s.totalValue,
            allocations: s.allocations
        }))

        const metrics = analyticsService.computeMetricsFromSnapshots(snapshots)

        return ok(res, {
            portfolioId,
            dailyValues,
            metrics: {
                totalReturnPercent: Math.round(metrics.totalReturn * 100) / 100,
                maxDrawdownPercent: Math.round(metrics.maxDrawdown * 100) / 100,
                sharpeRatio: Math.round(metrics.sharpeRatio * 1000) / 1000
            },
            dataPoints: snapshots.length
        })
    } catch (error) {
        logger.error('Failed to fetch analytics', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

analyticsRouter.get('/portfolio/:id/performance-summary', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id

        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        const portfolio = portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        }

        const summary = analyticsService.getPerformanceSummary(portfolioId)

        return ok(res, { portfolioId, ...summary })
    } catch (error) {
        logger.error('Failed to fetch performance summary', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

analyticsRouter.get('/portfolio/:id/risk-diagnostics', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        let portfolio: any
        try {
            portfolio = await stellarService.getPortfolio(portfolioId)
        } catch (error) {
            const errMsg = getErrorMessage(error)
            if (errMsg.includes('Portfolio not found')) {
                return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
            }
            throw error
        }

        if (!portfolio) {
            return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        }

        const prices = await reflectorService.getCurrentPrices()
        const riskHeatmap = riskManagementService.calculateRiskHeatmap(portfolio.allocations, prices)

        return ok(res, { riskHeatmap })
    } catch (error) {
        logger.error('[ERROR] Get portfolio risk diagnostics failed', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

analyticsRouter.get('/portfolio/:id/benchmark', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        const from = req.query.from as string | undefined
        const to = req.query.to as string | undefined

        if (!portfolioId || !from || !to) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID, from, and to are required')
        }

        const portfolio = portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        }

        const fromDate = new Date(from)
        const toDate = new Date(to)

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Invalid date format')
        }

        // Get Portfolio Return
        const snapshots = analyticsService.getAnalyticsInRange(portfolioId, from, to)
        let portfolio_return = 0
        if (snapshots.length >= 2) {
            const initialValue = snapshots[0].totalValue
            const finalValue = snapshots[snapshots.length - 1].totalValue
            if (initialValue > 0) {
                portfolio_return = ((finalValue - initialValue) / initialValue) * 100
            }
        }

        // Dynamic import to avoid circular dependency or import issues at top level if not present
        const { getPriceHistoryInRange } = await import('../db/priceHistoryDb.js')

        // Get Benchmark Returns
        const getAssetReturn = async (asset: string) => {
            const history = await getPriceHistoryInRange(asset, fromDate, toDate)
            if (history.length < 2) return 0
            const pStart = history[0].price
            const pEnd = history[history.length - 1].price
            return pStart > 0 ? ((pEnd - pStart) / pStart) * 100 : 0
        }

        const xlmReturn = await getAssetReturn('XLM')
        const btcReturn = await getAssetReturn('BTC')
        const usdcReturn = await getAssetReturn('USDC')

        const benchmarks = [
            {
                name: 'XLM-only',
                portfolio_return,
                benchmark_return: xlmReturn,
                alpha: portfolio_return - xlmReturn
            },
            {
                name: 'BTC-only',
                portfolio_return,
                benchmark_return: btcReturn,
                alpha: portfolio_return - btcReturn
            },
            {
                name: '60/40 XLM-USDC',
                portfolio_return,
                benchmark_return: (0.6 * xlmReturn) + (0.4 * usdcReturn),
                alpha: portfolio_return - ((0.6 * xlmReturn) + (0.4 * usdcReturn))
            }
        ]

        return ok(res, { benchmarks })
    } catch (error) {
        logger.error('[ERROR] Get portfolio benchmark failed', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
