import { Router, Request, Response } from 'express'
import { StellarService } from '../services/stellar.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { analyticsService } from '../services/analyticsService.js'
import { ReflectorService } from '../services/reflector.js'
import { riskManagementService, rebalanceHistoryService } from '../services/serviceContainer.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'TUSD', 'USDN'])

const ASSET_VOLATILITY: Record<string, number> = {
    USDC: 3,
    USDT: 3,
    DAI: 5,
    BUSD: 5,
    FRAX: 6,
    TUSD: 5,
    XLM: 80,
    BTC: 55,
    ETH: 65,
    SOL: 75,
    ADA: 70,
    DOT: 72,
    MATIC: 78,
    ATOM: 68,
    LINK: 72,
    UNI: 76,
    XRP: 74,
    DOGE: 85,
    SHIB: 90,
}

const RISK_CACHE_TTL_MS = 10 * 60 * 1000

interface RiskScoreCacheEntry {
    data: RiskScoreResponse
    cachedAt: number
}

interface RiskScoreResponse {
    portfolioId: string
    riskScore: number
    riskLevel: 'very_low' | 'low' | 'moderate' | 'high' | 'very_high'
    breakdown: {
        volatility: { score: number; weight: number; contribution: number }
        concentration: { score: number; weight: number; contribution: number; hhi: number }
        maxAllocation: { score: number; weight: number; contribution: number; maxAllocationPct: number }
        correlation: { score: number; weight: number; contribution: number; averageCorrelation: number; assetCount: number }
    }
    cachedAt: string
}

const riskScoreCache = new Map<string, RiskScoreCacheEntry>()

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

function getAssetVolatility(asset: string): number {
    return ASSET_VOLATILITY[asset] ?? 60
}

function getRiskLevel(score: number): 'very_low' | 'low' | 'moderate' | 'high' | 'very_high' {
    if (score < 10) return 'very_low'
    if (score < 30) return 'low'
    if (score < 55) return 'moderate'
    if (score < 80) return 'high'
    return 'very_high'
}

function getFromCache(portfolioId: string): RiskScoreResponse | null {
    const entry = riskScoreCache.get(portfolioId)
    if (!entry) return null
    if (Date.now() - entry.cachedAt > RISK_CACHE_TTL_MS) {
        riskScoreCache.delete(portfolioId)
        return null
    }
    return entry.data
}

function setCache(portfolioId: string, data: RiskScoreResponse): void {
    riskScoreCache.set(portfolioId, { data, cachedAt: Date.now() })
}

function calculateRiskScore(
    portfolioId: string,
    allocations: Record<string, number>,
    prices: Record<string, { price: number }>
): RiskScoreResponse {
    const weights: Record<string, number> = {}
    let totalAlloc = 0
    for (const [asset, alloc] of Object.entries(allocations)) {
        const num = Number(alloc)
        if (Number.isFinite(num) && num > 0) {
            weights[asset] = num
            totalAlloc += num
        }
    }

    if (totalAlloc === 0) {
        const empty: RiskScoreResponse = {
            portfolioId,
            riskScore: 0,
            riskLevel: 'very_low',
            breakdown: {
                volatility: { score: 0, weight: 0.25, contribution: 0 },
                concentration: { score: 0, weight: 0.25, contribution: 0, hhi: 0 },
                maxAllocation: { score: 0, weight: 0.25, contribution: 0, maxAllocationPct: 0 },
                correlation: { score: 0, weight: 0.25, contribution: 0, averageCorrelation: 0, assetCount: 0 },
            },
            cachedAt: new Date().toISOString(),
        }
        return empty
    }

    const normalizedWeights: Record<string, number> = {}
    for (const [asset, w] of Object.entries(weights)) {
        normalizedWeights[asset] = w / totalAlloc
    }

    const weightedVolatility = Object.entries(normalizedWeights).reduce(
        (sum, [asset, w]) => sum + w * getAssetVolatility(asset),
        0
    )

    const assetCount = Object.keys(normalizedWeights).length

    let hhi = 0
    let maxWeight = 0
    for (const w of Object.values(normalizedWeights)) {
        hhi += w * w
        if (w > maxWeight) maxWeight = w
    }

    const assets = Object.keys(normalizedWeights)
    let avgAbsCorr = 0
    if (assetCount >= 2) {
        let corrSum = 0
        let corrCount = 0
        for (let i = 0; i < assets.length; i++) {
            const aVol = getAssetVolatility(assets[i]) / 100
            for (let j = i + 1; j < assets.length; j++) {
                const bVol = getAssetVolatility(assets[j]) / 100
                const isPairHighCorr = Math.abs(aVol - bVol) < 0.15
                const aIsStable = STABLECOINS.has(assets[i])
                const bIsStable = STABLECOINS.has(assets[j])

                let pairCorr: number
                if (aIsStable && bIsStable) {
                    pairCorr = 0.2
                } else if (aIsStable || bIsStable) {
                    pairCorr = 0.05
                } else if (isPairHighCorr) {
                    pairCorr = 0.75
                } else {
                    pairCorr = 0.5
                }
                corrSum += pairCorr
                corrCount++
            }
        }
        avgAbsCorr = corrCount > 0 ? corrSum / corrCount : 0
    } else {
        avgAbsCorr = 1.0
    }

    const riskMultiplier = Math.pow(weightedVolatility / 100, 0.85)

    const volScore = weightedVolatility
    const volContribution = volScore * 0.25

    const concScore = hhi * 100
    const concContribution = concScore * 0.25 * riskMultiplier

    const maxAllocScore = maxWeight * 100
    const maxAllocContribution = maxAllocScore * 0.25 * riskMultiplier

    const corrScore = avgAbsCorr * 100
    const corrContribution = corrScore * 0.25 * riskMultiplier

    const riskScore = Math.min(100, Math.round((volContribution + concContribution + maxAllocContribution + corrContribution) * 100) / 100)

    return {
        portfolioId,
        riskScore,
        riskLevel: getRiskLevel(riskScore),
        breakdown: {
            volatility: {
                score: Math.round(volScore * 100) / 100,
                weight: 0.25,
                contribution: Math.round(volContribution * 100) / 100,
            },
            concentration: {
                score: Math.round(concScore * 100) / 100,
                weight: 0.25,
                contribution: Math.round(concContribution * 100) / 100,
                hhi: Math.round(hhi * 10000) / 10000,
            },
            maxAllocation: {
                score: Math.round(maxAllocScore * 100) / 100,
                weight: 0.25,
                contribution: Math.round(maxAllocContribution * 100) / 100,
                maxAllocationPct: Math.round(maxWeight * 10000) / 100,
            },
            correlation: {
                score: Math.round(corrScore * 100) / 100,
                weight: 0.25,
                contribution: Math.round(corrContribution * 100) / 100,
                averageCorrelation: Math.round(avgAbsCorr * 1000) / 1000,
                assetCount,
            },
        },
        cachedAt: new Date().toISOString(),
    }
}

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

analyticsRouter.get('/portfolio/:id/risk-score', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        const cached = getFromCache(portfolioId)
        if (cached) {
            return ok(res, cached)
        }

        const portfolio = portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        }

        const prices = await reflectorService.getCurrentPrices()

        const data = calculateRiskScore(
            portfolioId,
            portfolio.allocations,
            prices
        )

        setCache(portfolioId, data)

        return ok(res, data)
    } catch (error) {
        logger.error('Failed to calculate risk score', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
