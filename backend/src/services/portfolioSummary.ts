/**
 * Portfolio summary projection.
 *
 * Builds the compact per-portfolio view served by
 * `GET /api/v1/portfolios/summary`: current USD value, a coarse drift status,
 * and the last rebalance timestamp.
 *
 * These are pure functions over an already-fetched price map. The caller reads
 * prices once and passes the same map for every portfolio, which is what keeps
 * a dashboard render at one price lookup instead of one per portfolio.
 *
 * Valuation follows `rebalancePlan.ts`: assets are the union of the allocation
 * targets and the held balances, a missing price contributes zero rather than
 * being assumed, and all arithmetic goes through `Dec` so repeated addition
 * does not accumulate float error.
 */

import { Dec } from '../utils/decimal.js'
import type { Portfolio, PricesMap } from '../types/index.js'

export type DriftStatus = 'ok' | 'warning' | 'critical'

export interface PortfolioSummary {
    id: string
    name: string | null
    total_value_usd: number
    drift_status: DriftStatus
    last_rebalanced: string | null
}

/**
 * Fraction of a portfolio's own rebalance threshold at which drift stops being
 * `ok` and becomes `warning`. Drift past the threshold itself is `critical`.
 *
 * The bands are relative to each portfolio's configured threshold rather than
 * fixed percentages, so a 2%-threshold portfolio and a 10%-threshold portfolio
 * both report against the tolerance their owner actually chose.
 */
export const DRIFT_WARNING_RATIO = 0.5

/** Assets that carry a target weight, a balance, or both. */
function assetSymbols(portfolio: Portfolio): string[] {
    return Array.from(new Set([
        ...Object.keys(portfolio.allocations || {}),
        ...Object.keys(portfolio.balances || {})
    ])).sort()
}

/** Current USD value of everything the portfolio holds. */
export function computeTotalValueUsd(portfolio: Portfolio, prices: PricesMap): number {
    return assetSymbols(portfolio).reduce((sum, asset) => {
        const balance = portfolio.balances?.[asset] ?? 0
        const price = prices[asset]?.price ?? 0
        return Dec.add(sum, Dec.mul(balance, price))
    }, 0)
}

/**
 * Largest gap, in percentage points, between any asset's current weight and its
 * target weight. Returns 0 for an empty or unpriced portfolio, where no weight
 * is defined.
 */
export function computeMaxDriftPercent(
    portfolio: Portfolio,
    prices: PricesMap,
    totalValueUsd: number
): number {
    if (totalValueUsd <= 0) return 0

    return assetSymbols(portfolio).reduce((max, asset) => {
        const balance = portfolio.balances?.[asset] ?? 0
        const price = prices[asset]?.price ?? 0
        const currentPercent = Dec.percentage(Dec.mul(balance, price), totalValueUsd)
        const targetPercent = portfolio.allocations?.[asset] ?? 0
        return Math.max(max, Dec.drift(currentPercent, targetPercent))
    }, 0)
}

/**
 * Classify drift against the portfolio's rebalance threshold.
 *
 * `critical` uses the same comparison the auto-rebalancer uses to decide a
 * portfolio has drifted, so a portfolio reported critical here is one the
 * rebalancer would act on.
 */
export function classifyDrift(maxDriftPercent: number, threshold: number): DriftStatus {
    if (maxDriftPercent > threshold) return 'critical'
    if (threshold > 0 && maxDriftPercent >= threshold * DRIFT_WARNING_RATIO) return 'warning'
    return 'ok'
}

export function buildPortfolioSummary(portfolio: Portfolio, prices: PricesMap): PortfolioSummary {
    const totalValueUsd = computeTotalValueUsd(portfolio, prices)
    const maxDriftPercent = computeMaxDriftPercent(portfolio, prices, totalValueUsd)

    return {
        id: portfolio.id,
        name: portfolio.name ?? null,
        total_value_usd: totalValueUsd,
        drift_status: classifyDrift(maxDriftPercent, portfolio.threshold),
        last_rebalanced: portfolio.lastRebalance ?? null
    }
}

/** Project a whole set of portfolios against one shared price map. */
export function buildPortfolioSummaries(
    portfolios: Portfolio[],
    prices: PricesMap
): PortfolioSummary[] {
    return portfolios.map((portfolio) => buildPortfolioSummary(portfolio, prices))
}
