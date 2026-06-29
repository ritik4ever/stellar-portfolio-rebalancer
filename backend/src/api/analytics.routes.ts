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

const CORRELATION_CACHE_TTL_MS = 60 * 60 * 1000

type CorrelationCacheEntry = {
    expiresAt: number
    value: Record<string, unknown>
}

const correlationCache = new Map<string, CorrelationCacheEntry>()

function buildCorrelationCacheKey(assets: string[], days: number): string {
    return `${assets.join(',')}:${days}`
}

function normalizeAssetList(assetsParam: string | undefined): string[] {
    if (!assetsParam) return []
    const normalized = assetsParam
        .split(',')
        .map((asset) => asset.trim().toUpperCase())
        .filter((asset) => asset.length > 0)

    return [...new Set(normalized)]
}

function calculatePearson(seriesA: number[], seriesB: number[]): number {
    const n = Math.min(seriesA.length, seriesB.length)
    if (n < 2) return 0

    const meanA = seriesA.reduce((sum, value) => sum + value, 0) / n
    const meanB = seriesB.reduce((sum, value) => sum + value, 0) / n

    let numerator = 0
    let varA = 0
    let varB = 0

    for (let i = 0; i < n; i++) {
        const da = seriesA[i] - meanA
        const db = seriesB[i] - meanB
        numerator += da * db
        varA += da * da
        varB += db * db
    }

    const denominator = Math.sqrt(varA * varB)
    if (denominator === 0) return 0
    return Math.max(-1, Math.min(1, numerator / denominator))
}

function buildReturnSeries(history: Array<{ timestamp: number; price: number }>): Array<{ timestamp: number; value: number }> {
    const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp)
    const returns: Array<{ timestamp: number; value: number }> = []

    for (let i = 1; i < sorted.length; i++) {
        const prevPrice = sorted[i - 1].price
        const currentPrice = sorted[i].price
        const value = prevPrice === 0 ? 0 : (currentPrice - prevPrice) / prevPrice
        returns.push({ timestamp: sorted[i].timestamp, value })
    }

    return returns
}

function getCommonTimestamps(historyByAsset: Record<string, Array<{ timestamp: number; value: number }>>): number[] {
    const assetKeys = Object.keys(historyByAsset)
    if (assetKeys.length === 0) return []

    const timestampSets = assetKeys.map((asset) => new Set(historyByAsset[asset].map((point) => point.timestamp)))
    return [...timestampSets[0]].filter((timestamp) => timestampSets.every((set) => set.has(timestamp))).sort((a, b) => a - b)
}

function buildAlignedReturns(
    assets: string[],
    historyByAsset: Record<string, Array<{ timestamp: number; price: number }>>
): Record<string, number[]> {
    const returnHistoryByAsset: Record<string, Array<{ timestamp: number; value: number }>> = {}
    assets.forEach((asset) => {
        returnHistoryByAsset[asset] = buildReturnSeries(historyByAsset[asset] ?? [])
    })

    const commonTimestamps = getCommonTimestamps(returnHistoryByAsset)
    const aligned: Record<string, number[]> = {}

    assets.forEach((asset) => {
        const priceMap = new Map(returnHistoryByAsset[asset].map((point) => [point.timestamp, point.value]))
        aligned[asset] = commonTimestamps.map((timestamp) => priceMap.get(timestamp) ?? 0)
    })

    return aligned
}

function buildCorrelationMatrix(
    assets: string[],
    alignedReturns: Record<string, number[]>
): Record<string, Record<string, number>> {
    const matrix: Record<string, Record<string, number>> = {}

    assets.forEach((assetA) => {
        matrix[assetA] = {}
        assets.forEach((assetB) => {
            if (assetA === assetB) {
                matrix[assetA][assetB] = 1
            } else if (matrix[assetB]?.[assetA] !== undefined) {
                matrix[assetA][assetB] = matrix[assetB][assetA]
            } else {
                matrix[assetA][assetB] = calculatePearson(alignedReturns[assetA], alignedReturns[assetB])
            }
        })
    })

    return matrix
}

export function clearCorrelationCache(): void {
    correlationCache.clear()
}

analyticsRouter.get('/analytics/correlation', async (req: Request, res: Response) => {
    try {
        const assets = normalizeAssetList(req.query.assets as string | undefined)
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 30

        if (assets.length === 0) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Query parameter assets is required and must include at least one asset code')
        }

        if (assets.some((asset) => asset.length === 0)) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Asset codes must be non-empty')
        }

        if (Number.isNaN(days) || days < 1) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Query parameter days must be a positive integer')
        }

        const sortedAssets = [...assets].sort()
        const cacheKey = buildCorrelationCacheKey(sortedAssets, days)
        const now = Date.now()
        const cached = correlationCache.get(cacheKey)

        if (cached && cached.expiresAt > now) {
            return ok(res, cached.value)
        }

        const historyByAsset: Record<string, Array<{ timestamp: number; price: number }>> = {}
        await Promise.all(sortedAssets.map(async (asset) => {
            historyByAsset[asset] = await reflectorService.getPriceHistory(asset, days)
        }))

        const alignedReturns = buildAlignedReturns(sortedAssets, historyByAsset)
        const correlationMatrix = buildCorrelationMatrix(sortedAssets, alignedReturns)
        const result = {
            assets: sortedAssets,
            days,
            correlationMatrix,
            sampleSize: Object.values(alignedReturns)[0]?.length ?? 0
        }

        correlationCache.set(cacheKey, {
            value: result,
            expiresAt: now + CORRELATION_CACHE_TTL_MS
        })

        return ok(res, result)
    } catch (error) {
        logger.error('Failed to fetch correlation matrix', { error: getErrorObject(error), route: req.path })
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
