import { Router, Request, Response } from 'express'
import { StellarService } from '../services/stellar.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { analyticsService } from '../services/analyticsService.js'
import { ReflectorService } from '../services/reflector.js'
import { riskManagementService, rebalanceHistoryService } from '../services/serviceContainer.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const analyticsRouter = Router()

const stellarService = new StellarService()
const reflectorService = new ReflectorService()

analyticsRouter.get('/portfolios/compare', async (req: Request, res: Response) => {
    try {
        const idsParam = req.query.ids as string | undefined
        const from = req.query.from as string | undefined
        const to = req.query.to as string | undefined

        if (!idsParam) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio IDs required (comma-separated)')
        }

        const ids = idsParam.split(',').map(id => id.trim()).filter(Boolean)

        if (ids.length < 2) {
            return fail(res, 400, 'VALIDATION_ERROR', 'At least 2 portfolio IDs required for comparison')
        }

        if (ids.length > 3) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Maximum 3 portfolios can be compared at once')
        }

        const fromDate = from ? new Date(from) : null
        const toDate = to ? new Date(to) : null

        if (fromDate && isNaN(fromDate.getTime())) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Invalid from date format. Use ISO 8601 (e.g. 2025-01-01T00:00:00Z)')
        }
        if (toDate && isNaN(toDate.getTime())) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Invalid to date format. Use ISO 8601 (e.g. 2025-01-01T00:00:00Z)')
        }

        const now = new Date()
        if ((fromDate && fromDate > now) || (toDate && toDate > now)) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Future dates are not accepted')
        }

        if (fromDate && toDate && fromDate > toDate) {
            return fail(res, 400, 'VALIDATION_ERROR', 'from date must be before to date')
        }

        const portfolios = await Promise.all(
            ids.map(async (id) => {
                const portfolio = await portfolioStorage.getPortfolio(id)
                return portfolio ? { id, portfolio } : null
            })
        )

        const missingIds = portfolios.filter(p => !p).map((_, i) => ids[i])
        if (missingIds.length > 0) {
            return fail(res, 404, 'NOT_FOUND', `Portfolios not found: ${missingIds.join(', ')}`)
        }

        const comparisonData = await Promise.all(
            portfolios.map(async (entry) => {
                if (!entry) return null
                const { id, portfolio } = entry

                let snapshots
                if (fromDate && toDate) {
                    snapshots = analyticsService.getAnalyticsInRange(id, from, to!)
                } else {
                    snapshots = analyticsService.getAnalytics(id, 90)
                }

                const metrics = analyticsService.computeMetricsFromSnapshots(snapshots)
                const rebalanceCount = await rebalanceHistoryService.getRebalanceHistoryCount(id)

                return {
                    portfolioId: id,
                    name: portfolio.name || id,
                    totalValue: portfolio.totalValue || 0,
                    totalReturnPct: Math.round(metrics.totalReturn * 100) / 100,
                    volatility: Math.round(metrics.volatility * 100) / 100,
                    maxDrawdown: Math.round(metrics.maxDrawdown * 100) / 100,
                    sharpeRatio: Math.round(metrics.sharpeRatio * 1000) / 1000,
                    rebalanceCount,
                    dataPoints: snapshots.length,
                }
            })
        )

        return ok(res, {
            portfolios: comparisonData,
            timeRange: {
                from: fromDate?.toISOString() ?? null,
                to: toDate?.toISOString() ?? null,
            },
        })
    } catch (error) {
        logger.error('Failed to compare portfolios', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

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
