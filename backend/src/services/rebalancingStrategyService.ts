import { Dec } from '../utils/decimal.js'
import type { Portfolio, PricesMap, RebalanceStrategyType, RebalanceStrategyConfig } from '../types/index.js'

export interface RebalanceStrategyContext {
    portfolio: Portfolio
    prices: PricesMap
    now?: number
}

/**
 * Determines if a portfolio should be rebalanced based on its configured strategy.
 */
export function shouldRebalanceByStrategy(context: RebalanceStrategyContext): boolean {
    const { portfolio, prices } = context
    const strategy = portfolio.strategy ?? 'threshold'
    const config = portfolio.strategyConfig ?? {}
    const now = context.now ?? Date.now()

    switch (strategy) {
        case 'threshold':
            return thresholdStrategy(portfolio, prices)
        case 'periodic':
            return periodicStrategy(portfolio, config, now)
        case 'volatility':
            return volatilityStrategy(portfolio, prices, config, now)
        case 'custom':
            return customStrategy(portfolio, prices, config, now)
        default:
            return thresholdStrategy(portfolio, prices)
    }
}

function thresholdStrategy(portfolio: Portfolio, prices: PricesMap): boolean {
    const balances = portfolio.balances ?? {}
    let totalValue = 0
    const currentValues: Record<string, number> = {}
    for (const [asset, balance] of Object.entries(balances)) {
        const price = prices[asset]?.price ?? 0
        const value = balance * price
        currentValues[asset] = value
        totalValue += value
    }
    if (totalValue <= 0) return false
    const threshold = portfolio.threshold ?? 5
    for (const [asset, targetPercentage] of Object.entries(portfolio.allocations)) {
        const currentValue = currentValues[asset] ?? 0
        const currentPercentage = Dec.percentage(currentValue, totalValue)
        const drift = Dec.drift(currentPercentage, targetPercentage)
        if (drift > 50) return false
        if (drift > threshold) return true
    }
    return false
}

function periodicStrategy(portfolio: Portfolio, config: RebalanceStrategyConfig, now: number): boolean {
    const intervalDays = config.intervalDays ?? 7
    const lastMs = new Date(portfolio.lastRebalance).getTime()
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000
    return now - lastMs >= intervalMs
}

function volatilityStrategy(
    portfolio: Portfolio,
    prices: PricesMap,
    config: RebalanceStrategyConfig,
    _now: number
): boolean {
    const volatilityThresholdPct = config.volatilityThresholdPct ?? 10
    const maxAbsChange = Math.max(
        0,
        ...Object.values(prices).map((p) => Math.abs((p as { change?: number }).change ?? 0))
    )
    if (maxAbsChange >= volatilityThresholdPct) return true
    return thresholdStrategy(portfolio, prices)
}

function customStrategy(
    portfolio: Portfolio,
    prices: PricesMap,
    config: RebalanceStrategyConfig,
    now: number
): boolean {
    const minDays = config.minDaysBetweenRebalance ?? 1
    const lastMs = new Date(portfolio.lastRebalance).getTime()
    const minMs = minDays * 24 * 60 * 60 * 1000
    if (now - lastMs < minMs) return false
    return thresholdStrategy(portfolio, prices)
}

export const REBALANCE_STRATEGIES: { value: RebalanceStrategyType; label: string; description: string }[] = [
    { value: 'threshold', label: 'Threshold-based', description: 'Rebalance when allocation drift exceeds the configured threshold (%).' },
    { value: 'periodic', label: 'Periodic (time-based)', description: 'Rebalance on a fixed schedule (e.g. every 7 or 30 days).' },
    { value: 'volatility', label: 'Volatility-based', description: 'Rebalance when market volatility exceeds a percentage threshold.' },
    { value: 'custom', label: 'Custom rules', description: 'User-defined: minimum days between rebalances plus threshold check.' },
]
