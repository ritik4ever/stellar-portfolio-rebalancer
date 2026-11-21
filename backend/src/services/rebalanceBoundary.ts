import type { PriceFeedMeta, PricesMap } from '../types/index.js'
import type { RebalancePlan } from './rebalancePlan.js'

export type RebalancePlanResult = 'no_trades_needed' | 'trades_required'

export type RebalancePlanReasonCode =
    | 'WITHIN_EVERY_THRESHOLD'
    | 'DRIFT_EXCEEDS_THRESHOLD'
    | 'TRADES_REQUIRED'

export interface DeterministicTrade {
    asset: string
    action: 'buy' | 'sell'
    amount: number
    value: number
}

export interface PlanQuoteSnapshot {
    prices?: PricesMap
    feedMeta: PriceFeedMeta
}

export interface RebalancePlanBoundaryDecision {
    result: RebalancePlanResult
    reasonCode: RebalancePlanReasonCode
    reason: string
    withinEveryThreshold: boolean
    thresholdPercent: number
    maxDriftPercent: number
    trades: DeterministicTrade[]
    quoteSnapshot: PlanQuoteSnapshot
}

export function evaluateRebalancePlanBoundary(
    plan: Omit<RebalancePlan, 'boundary'>,
    thresholdPercent: number
): RebalancePlanBoundaryDecision {
    const threshold = Number.isFinite(thresholdPercent) && thresholdPercent >= 0 ? thresholdPercent : 0
    const maxDriftPercent = plan.assets.reduce(
        (max, asset) => Math.max(max, Math.abs(asset.driftPercent)),
        0
    )
    const trades: DeterministicTrade[] = plan.assets
        .filter((asset) => asset.action !== 'hold')
        .map((asset) => ({
            asset: asset.asset,
            action: asset.action as 'buy' | 'sell',
            amount: asset.action === 'buy' ? asset.buyAmount : asset.sellAmount,
            value: asset.tradeValue,
        }))
    const withinEveryThreshold = trades.length === 0 && maxDriftPercent <= threshold
    const reasonCode: RebalancePlanReasonCode = withinEveryThreshold
        ? 'WITHIN_EVERY_THRESHOLD'
        : trades.length > 0
            ? 'TRADES_REQUIRED'
            : 'DRIFT_EXCEEDS_THRESHOLD'

    return {
        result: withinEveryThreshold ? 'no_trades_needed' : 'trades_required',
        reasonCode,
        reason: withinEveryThreshold
            ? 'Every asset is within the configured drift threshold and the trade list is empty'
            : trades.length > 0
                ? 'The plan contains trades derived from the captured quote snapshot'
                : 'At least one asset exceeds the configured drift threshold',
        withinEveryThreshold,
        thresholdPercent: threshold,
        maxDriftPercent,
        trades,
        quoteSnapshot: {
            prices: plan.prices,
            feedMeta: plan.priceFeedMeta,
        },
    }
}
