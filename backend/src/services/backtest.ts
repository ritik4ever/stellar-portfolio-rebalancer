import { ReflectorService } from './reflector.js'

// Historical threshold-rebalance simulator (#1855).
//
// Replays daily closing prices and applies the same trigger the live
// threshold strategy uses (rebalancingStrategyService.thresholdStrategy):
// rebalance back to target weights whenever any asset's drift, in percentage
// points, exceeds the threshold. Results are compared against buy-and-hold.
// Fees, slippage and on-chain constraints are intentionally not modelled.

export const BACKTEST_DISCLAIMER =
    'Historical simulation only. Replays past daily closing prices and ignores fees, slippage ' +
    'and execution timing. Past performance does not guarantee future results.'

const DAY_SECONDS = 24 * 60 * 60

export interface PricePoint {
    /** Unix seconds */
    timestamp: number
    price: number
}

export interface BacktestInput {
    /** Target weights in percent, summing to 100 */
    allocations: Record<string, number>
    /** Drift threshold in percentage points */
    threshold: number
    initialValue: number
    history: Record<string, PricePoint[]>
}

export interface BacktestTimelinePoint {
    timestamp: number
    value: number
    buyAndHoldValue: number
    maxDriftPct: number
    rebalanced: boolean
}

export interface BacktestRebalanceEvent {
    timestamp: number
    /** Largest drift observed at the moment the rebalance triggered */
    maxDriftPct: number
    asset: string
    portfolioValue: number
}

export interface BacktestResult {
    threshold: number
    allocations: Record<string, number>
    startTimestamp: number
    endTimestamp: number
    days: number
    initialValue: number
    finalValue: number
    totalReturnPct: number
    buyAndHoldFinalValue: number
    buyAndHoldReturnPct: number
    rebalanceCount: number
    maxDrawdownPct: number
    maxDriftObservedPct: number
    events: BacktestRebalanceEvent[]
    timeline: BacktestTimelinePoint[]
}

export class BacktestDataError extends Error {}

/** Collapse a price series to one closing price per UTC day. */
export function toDailyCloses(points: PricePoint[]): Map<number, number> {
    const closes = new Map<number, { timestamp: number; price: number }>()
    for (const point of points) {
        if (!Number.isFinite(point.price) || point.price <= 0) continue
        const day = Math.floor(point.timestamp / DAY_SECONDS) * DAY_SECONDS
        const existing = closes.get(day)
        if (!existing || point.timestamp >= existing.timestamp) {
            closes.set(day, { timestamp: point.timestamp, price: point.price })
        }
    }
    return new Map([...closes].map(([day, { price }]) => [day, price]))
}

function round(value: number, decimals = 2): number {
    const factor = 10 ** decimals
    return Math.round(value * factor) / factor
}

export function runBacktest(input: BacktestInput): BacktestResult {
    const assets = Object.keys(input.allocations)
    const dailyByAsset = new Map<string, Map<number, number>>()
    for (const asset of assets) {
        const points = input.history[asset]
        if (!points || points.length === 0) {
            throw new BacktestDataError(`No historical prices available for ${asset}`)
        }
        dailyByAsset.set(asset, toDailyCloses(points))
    }

    // Only days where every asset has a real close — no interpolation.
    const days = [...dailyByAsset.get(assets[0])!.keys()]
        .filter((day) => assets.every((asset) => dailyByAsset.get(asset)!.has(day)))
        .sort((a, b) => a - b)
    if (days.length < 2) {
        throw new BacktestDataError('Not enough overlapping price history across the selected assets')
    }

    const priceAt = (asset: string, day: number) => dailyByAsset.get(asset)!.get(day)!
    const targetUnits = (value: number, day: number) =>
        Object.fromEntries(
            assets.map((asset) => [asset, (value * input.allocations[asset]) / 100 / priceAt(asset, day)]),
        )
    const valueOf = (units: Record<string, number>, day: number) =>
        assets.reduce((sum, asset) => sum + units[asset] * priceAt(asset, day), 0)

    let units = targetUnits(input.initialValue, days[0])
    const buyAndHoldUnits = { ...units }

    const timeline: BacktestTimelinePoint[] = []
    const events: BacktestRebalanceEvent[] = []
    let peak = input.initialValue
    let maxDrawdownPct = 0
    let maxDriftObservedPct = 0

    for (const [index, day] of days.entries()) {
        const value = valueOf(units, day)

        let maxDriftPct = 0
        let driftAsset = assets[0]
        for (const asset of assets) {
            const actualPct = ((units[asset] * priceAt(asset, day)) / value) * 100
            const drift = Math.abs(actualPct - input.allocations[asset])
            if (drift > maxDriftPct) {
                maxDriftPct = drift
                driftAsset = asset
            }
        }
        maxDriftObservedPct = Math.max(maxDriftObservedPct, maxDriftPct)

        const rebalanced = index > 0 && maxDriftPct > input.threshold
        if (rebalanced) {
            units = targetUnits(value, day)
            events.push({
                timestamp: day,
                maxDriftPct: round(maxDriftPct),
                asset: driftAsset,
                portfolioValue: round(value),
            })
        }

        peak = Math.max(peak, value)
        maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - value) / peak) * 100)

        timeline.push({
            timestamp: day,
            value: round(value),
            buyAndHoldValue: round(valueOf(buyAndHoldUnits, day)),
            maxDriftPct: round(maxDriftPct),
            rebalanced,
        })
    }

    const lastDay = days[days.length - 1]
    const finalValue = valueOf(units, lastDay)
    const buyAndHoldFinalValue = valueOf(buyAndHoldUnits, lastDay)

    return {
        threshold: input.threshold,
        allocations: input.allocations,
        startTimestamp: days[0],
        endTimestamp: lastDay,
        days: days.length,
        initialValue: input.initialValue,
        finalValue: round(finalValue),
        totalReturnPct: round(((finalValue - input.initialValue) / input.initialValue) * 100),
        buyAndHoldFinalValue: round(buyAndHoldFinalValue),
        buyAndHoldReturnPct: round(((buyAndHoldFinalValue - input.initialValue) / input.initialValue) * 100),
        rebalanceCount: events.length,
        maxDrawdownPct: round(maxDrawdownPct),
        maxDriftObservedPct: round(maxDriftObservedPct),
        events,
        timeline,
    }
}

/**
 * Fetch real daily price history for each asset. Uses the strict CoinGecko
 * fetch so a backtest never runs on synthetic prices.
 */
export async function fetchBacktestHistory(
    reflector: Pick<ReflectorService, 'getMarketPriceHistory'>,
    assets: string[],
    days: number,
): Promise<Record<string, PricePoint[]>> {
    const entries = await Promise.all(
        assets.map(async (asset) => {
            try {
                return [asset, await reflector.getMarketPriceHistory(asset, days)] as const
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                throw new BacktestDataError(`Historical prices unavailable for ${asset}: ${reason}`)
            }
        }),
    )
    return Object.fromEntries(entries)
}
