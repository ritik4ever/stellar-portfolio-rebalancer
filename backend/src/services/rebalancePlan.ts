import type { Portfolio, PriceFeedMeta, PricesMap } from '../types/index.js'
import { Dec } from '../utils/decimal.js'

export interface RebalanceAssetPlan {
    asset: string
    action: 'buy' | 'sell' | 'hold'
    currentBalance: number
    currentValue: number
    currentAllocationPercent: number
    targetAllocationPercent: number
    targetValue: number
    driftPercent: number
    buyAmount: number
    sellAmount: number
    tradeValue: number
    projectedBalance: number
    projectedValue: number
    projectedAllocationPercent: number
    price: number
}

export interface RebalancePlan {
    portfolioId: string
    totalValue: number
    maxSlippagePercent: number
    estimatedSlippageBps: number
    estimatedFees: {
        xlm: number
        usd: number
        perTradeXlm: number
        tradeCount: number
    }
    assets: RebalanceAssetPlan[]
    projectedAllocations: Record<string, number>
    prices?: PricesMap
    priceFeedMeta: PriceFeedMeta
}

const BASE_FEE_STROOPS = 100
const STROOPS_PER_XLM = 10_000_000
const MIN_TRADE_VALUE_USD = 0.01

function readBaseFeeXlm(): number {
    const parsed = Number(process.env.REBALANCE_DRY_RUN_BASE_FEE_STROOPS)
    const stroops = Number.isFinite(parsed) && parsed > 0 ? parsed : BASE_FEE_STROOPS
    return Dec.roundStellar(stroops / STROOPS_PER_XLM)
}

export function buildRebalancePlan(
    portfolio: Portfolio,
    prices: PricesMap,
    priceFeedMeta: PriceFeedMeta
): RebalancePlan {
    const assetSymbols = Array.from(new Set([
        ...Object.keys(portfolio.allocations || {}),
        ...Object.keys(portfolio.balances || {})
    ])).sort()
    const valuesByAsset: Record<string, number> = {}
    const totalValue = assetSymbols.reduce((sum, asset) => {
        const balance = portfolio.balances?.[asset] ?? 0
        const price = prices[asset]?.price ?? 0
        const value = Dec.mul(balance, price)
        valuesByAsset[asset] = value
        return Dec.add(sum, value)
    }, 0)
    const slippageTolerancePercent = portfolio.slippageTolerancePercent ?? portfolio.slippageTolerance ?? 1
    const estimatedSlippageBps = Math.round(slippageTolerancePercent * 100)

    let tradeCount = 0
    const assets = assetSymbols.map((asset): RebalanceAssetPlan => {
        const price = prices[asset]?.price ?? 0
        const currentBalance = portfolio.balances?.[asset] ?? 0
        const currentValue = valuesByAsset[asset] ?? 0
        const targetAllocationPercent = portfolio.allocations?.[asset] ?? 0
        const currentAllocationPercent = Dec.percentage(currentValue, totalValue)
        const targetValue = Dec.targetValue(totalValue, targetAllocationPercent)
        const diffValue = Dec.sub(targetValue, currentValue)
        const buyAmount = diffValue > MIN_TRADE_VALUE_USD && price > 0
            ? Dec.assetQtyFromValue(diffValue, price)
            : 0
        const sellAmount = diffValue < -MIN_TRADE_VALUE_USD && price > 0
            ? Dec.assetQtyFromValue(Math.abs(diffValue), price)
            : 0
        const action = buyAmount > 0 ? 'buy' : sellAmount > 0 ? 'sell' : 'hold'
        const projectedBalance = action === 'buy'
            ? Dec.add(currentBalance, buyAmount)
            : action === 'sell'
                ? Math.max(0, Dec.sub(currentBalance, sellAmount))
                : currentBalance
        const projectedValue = Dec.mul(projectedBalance, price)

        if (action !== 'hold') tradeCount += 1

        return {
            asset,
            action,
            currentBalance,
            currentValue,
            currentAllocationPercent,
            targetAllocationPercent,
            targetValue,
            driftPercent: Dec.drift(currentAllocationPercent, targetAllocationPercent),
            buyAmount,
            sellAmount,
            tradeValue: Math.abs(diffValue) > MIN_TRADE_VALUE_USD ? Math.abs(diffValue) : 0,
            projectedBalance,
            projectedValue,
            projectedAllocationPercent: 0,
            price
        }
    })

    const projectedTotalValue = assets.reduce((sum, asset) => Dec.add(sum, asset.projectedValue), 0)
    const projectedAllocations: Record<string, number> = {}
    for (const assetPlan of assets) {
        assetPlan.projectedAllocationPercent = Dec.percentage(assetPlan.projectedValue, projectedTotalValue)
        projectedAllocations[assetPlan.asset] = assetPlan.projectedAllocationPercent
    }

    const perTradeFeeXlm = readBaseFeeXlm()
    const totalFeeXlm = Dec.roundStellar(perTradeFeeXlm * tradeCount)
    const xlmPriceUsd = prices.XLM?.price ?? 0

    return {
        portfolioId: portfolio.id,
        totalValue,
        maxSlippagePercent: slippageTolerancePercent,
        estimatedSlippageBps,
        estimatedFees: {
            xlm: totalFeeXlm,
            usd: Dec.roundStellar(totalFeeXlm * xlmPriceUsd),
            perTradeXlm: perTradeFeeXlm,
            tradeCount
        },
        assets,
        projectedAllocations,
        prices: Object.keys(prices).length > 0 ? prices : undefined,
        priceFeedMeta
    }
}
