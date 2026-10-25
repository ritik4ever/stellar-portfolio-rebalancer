import { ReflectorService } from './reflector.js'

// Historical threshold-rebalance simulator (SPR-2026-151).
//
// Replays daily closing prices and applies the same trigger the live
// threshold strategy uses (rebalancingStrategyService.thresholdStrategy):
// rebalance back to target weights whenever any asset's drift, in percentage
// points, exceeds the threshold. Results are compared against buy-and-hold.
// Fees, slippage and on-chain constraints are intentionally not modelled.

export const BACKTEST_DISCLAIMER =
    'Historical simulation only. Replays past daily closing prices and ignores fees, slippage ' +
    'and execution timing. Past performance does not guarantee future results.'

export const DAY_SECONDS = 24 * 60 * 60

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
    windowStart?: number
    windowEnd?: number
}

export interface AbsentDayDetail {
    date: string
    timestamp: number
    isLeapDay: boolean
    missingAssets: string[]
    reason: string
}

export interface BacktestWindowDecision {
    status: 'completed' | 'insufficient_data'
    totalWindowDays: number
    includedDaysCount: number
    absentDaysCount: number
    hasLeapDay: boolean
    leapDayIncluded: boolean
    includedDays: string[]
    absentDayReasons: Record<string, string>
    evaluationSummary: string
}

export interface BacktestTimelinePoint {
    timestamp: number
    date: string
    value: number
    buyAndHoldValue: number
    maxDriftPct: number
    rebalanced: boolean
}

export interface BacktestRebalanceEvent {
    timestamp: number
    date: string
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
    startDate: string
    endDate: string
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
    includedDays: string[]
    absentDayReasons: Record<string, string>
    absentDays: AbsentDayDetail[]
    decision: BacktestWindowDecision
}

export type BacktestStatus = 'completed' | 'failed' | 'running'

export interface BacktestMetricsSummary {
    days: number
    initialValue: number
    finalValue: number
    totalReturnPct: number
    buyAndHoldFinalValue: number
    buyAndHoldReturnPct: number
    rebalanceCount: number
    maxDrawdownPct: number
    maxDriftObservedPct: number
}

export interface BacktestRecord {
    id: string
    portfolioId?: string
    allocations: Record<string, number>
    threshold: number
    initialValue: number
    days: number
    from?: string
    to?: string
    startDate?: string
    endDate?: string
    startTimestamp?: number
    endTimestamp?: number
    status: BacktestStatus
    hasLeapDay: boolean
    leapDayIncluded: boolean
    includedDays: string[]
    absentDayReasons: Record<string, string>
    absentDays: AbsentDayDetail[]
    decision?: BacktestWindowDecision
    events?: BacktestRebalanceEvent[]
    result?: BacktestMetricsSummary
    error?: string
    createdAt: string
    updatedAt: string
}

export class BacktestDataError extends Error {}

/**
 * Format Unix timestamp (seconds) into ISO UTC date string (YYYY-MM-DD).
 */
export function formatUtcDate(timestampSeconds: number): string {
    const d = new Date(timestampSeconds * 1000)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

/**
 * Check whether a given Unix timestamp (seconds) corresponds to a leap day (February 29 in UTC).
 */
export function isLeapDay(timestampSeconds: number): boolean {
    const d = new Date(timestampSeconds * 1000)
    return d.getUTCMonth() === 1 && d.getUTCDate() === 29
}

/**
 * Check whether a year is a leap year.
 */
export function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

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
    const assets = Object.keys(input.allocations).sort()
    if (assets.length === 0) {
        throw new BacktestDataError('No assets specified for backtest')
    }

    // Validation accepts totals within 0.01 of 100; normalise so holdings
    // always sum to the portfolio value and rebalances conserve it.
    const allocationTotal = assets.reduce((sum, asset) => sum + input.allocations[asset], 0)
    if (allocationTotal <= 0) {
        throw new BacktestDataError('Allocation weights must sum to a positive value')
    }
    const weights = Object.fromEntries(
        assets.map((asset) => [asset, (input.allocations[asset] / allocationTotal) * 100]),
    )

    const dailyByAsset = new Map<string, Map<number, number>>()
    const allTimestampsSet = new Set<number>()

    for (const asset of assets) {
        const points = input.history[asset]
        if (!points || points.length === 0) {
            throw new BacktestDataError(`No historical prices available for ${asset}`)
        }
        const dailyCloses = toDailyCloses(points)
        if (dailyCloses.size === 0) {
            throw new BacktestDataError(`No valid historical closing prices found for ${asset}`)
        }
        dailyByAsset.set(asset, dailyCloses)
        for (const day of dailyCloses.keys()) {
            allTimestampsSet.add(day)
        }
    }

    if (allTimestampsSet.size === 0) {
        throw new BacktestDataError('No historical prices available across the selected assets')
    }

    const sortedAvailableDays = [...allTimestampsSet].sort((a, b) => a - b)
    let minWindowDay = sortedAvailableDays[0]
    let maxWindowDay = sortedAvailableDays[sortedAvailableDays.length - 1]

    if (input.windowStart !== undefined) {
        const explicitStart = Math.floor(input.windowStart / DAY_SECONDS) * DAY_SECONDS
        minWindowDay = Math.max(minWindowDay, explicitStart)
    }
    if (input.windowEnd !== undefined) {
        const explicitEnd = Math.floor(input.windowEnd / DAY_SECONDS) * DAY_SECONDS
        maxWindowDay = Math.min(maxWindowDay, explicitEnd)
    }

    if (minWindowDay > maxWindowDay) {
        throw new BacktestDataError('Invalid evaluation window: windowStart exceeds windowEnd')
    }

    // Construct full calendar day sequence for the window
    const windowDays: number[] = []
    for (let t = minWindowDay; t <= maxWindowDay; t += DAY_SECONDS) {
        windowDays.push(t)
    }

    const includedDays: string[] = []
    const simulatedDays: number[] = []
    const absentDayReasons: Record<string, string> = {}
    const absentDays: AbsentDayDetail[] = []

    for (const day of windowDays) {
        const dateStr = formatUtcDate(day)
        const isLeap = isLeapDay(day)
        const missingAssets = assets.filter((asset) => !dailyByAsset.get(asset)!.has(day)).sort()

        if (missingAssets.length === 0) {
            includedDays.push(dateStr)
            simulatedDays.push(day)
        } else {
            const reason = isLeap
                ? `Leap day price feed unavailable for asset(s): ${missingAssets.join(', ')}`
                : `Missing price data for asset(s): ${missingAssets.join(', ')}`
            absentDayReasons[dateStr] = reason
            absentDays.push({
                date: dateStr,
                timestamp: day,
                isLeapDay: isLeap,
                missingAssets,
                reason,
            })
        }
    }

    const hasLeapDay = windowDays.some((t) => isLeapDay(t))
    const leapDayIncluded = hasLeapDay && !absentDays.some((d) => d.isLeapDay)

    if (simulatedDays.length < 2) {
        throw new BacktestDataError('Not enough overlapping price history across the selected assets')
    }

    const priceAt = (asset: string, day: number) => dailyByAsset.get(asset)!.get(day)!
    const targetUnits = (value: number, day: number) =>
        Object.fromEntries(
            assets.map((asset) => [asset, (value * weights[asset]) / 100 / priceAt(asset, day)]),
        )
    const valueOf = (units: Record<string, number>, day: number) =>
        assets.reduce((sum, asset) => sum + units[asset] * priceAt(asset, day), 0)

    let units = targetUnits(input.initialValue, simulatedDays[0])
    const buyAndHoldUnits = { ...units }

    const timeline: BacktestTimelinePoint[] = []
    const events: BacktestRebalanceEvent[] = []
    let peak = input.initialValue
    let maxDrawdownPct = 0
    let maxDriftObservedPct = 0

    for (const [index, day] of simulatedDays.entries()) {
        const value = valueOf(units, day)
        const date = formatUtcDate(day)

        let maxDriftPct = 0
        let driftAsset = assets[0]
        for (const asset of assets) {
            const actualPct = ((units[asset] * priceAt(asset, day)) / value) * 100
            const drift = Math.abs(actualPct - weights[asset])
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
                date,
                maxDriftPct: round(maxDriftPct),
                asset: driftAsset,
                portfolioValue: round(value),
            })
        }

        peak = Math.max(peak, value)
        maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - value) / peak) * 100)

        timeline.push({
            timestamp: day,
            date,
            value: round(value),
            buyAndHoldValue: round(valueOf(buyAndHoldUnits, day)),
            maxDriftPct: round(maxDriftPct),
            rebalanced,
        })
    }

    const firstDay = simulatedDays[0]
    const lastDay = simulatedDays[simulatedDays.length - 1]
    const finalValue = valueOf(units, lastDay)
    const buyAndHoldFinalValue = valueOf(buyAndHoldUnits, lastDay)

    const evaluationSummary = hasLeapDay
        ? (leapDayIncluded
            ? `Evaluated ${includedDays.length} of ${windowDays.length} window days; leap day (Feb 29) successfully included.`
            : `Evaluated ${includedDays.length} of ${windowDays.length} window days; leap day (Feb 29) absent (${absentDayReasons[formatUtcDate(windowDays.find((t) => isLeapDay(t))!)] || 'no quote'}).`)
        : `Evaluated ${includedDays.length} of ${windowDays.length} window days with ${absentDays.length} absent day(s).`

    const decision: BacktestWindowDecision = {
        status: 'completed',
        totalWindowDays: windowDays.length,
        includedDaysCount: includedDays.length,
        absentDaysCount: absentDays.length,
        hasLeapDay,
        leapDayIncluded,
        includedDays: [...includedDays],
        absentDayReasons: { ...absentDayReasons },
        evaluationSummary,
    }

    return {
        threshold: input.threshold,
        allocations: input.allocations,
        startTimestamp: firstDay,
        endTimestamp: lastDay,
        startDate: formatUtcDate(firstDay),
        endDate: formatUtcDate(lastDay),
        days: simulatedDays.length,
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
        includedDays,
        absentDayReasons,
        absentDays,
        decision,
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
    now: number = Date.now(),
    range?: { from?: string; to?: string },
): Promise<Record<string, PricePoint[]>> {
    let queryDays = days
    if (range?.from) {
        const fromMs = new Date(range.from).getTime()
        if (!Number.isNaN(fromMs)) {
            const diffDays = Math.ceil((now - fromMs) / (1000 * DAY_SECONDS))
            queryDays = Math.min(Math.max(diffDays, days), 365)
        }
    }

    // Drop the current UTC day: it is still open, and its latest intraday
    // point would otherwise be treated as that day's close.
    const currentDay = Math.floor(now / 1000 / DAY_SECONDS) * DAY_SECONDS
    const entries = await Promise.all(
        assets.map(async (asset) => {
            let history: PricePoint[]
            try {
                history = await reflector.getMarketPriceHistory(asset, queryDays)
            } catch (error) {
                throw new BacktestDataError(`Historical prices unavailable for ${asset}`, { cause: error })
            }
            let filtered = history.filter((point) => point.timestamp < currentDay)
            if (range?.from) {
                const fromTs = Math.floor(new Date(range.from).getTime() / 1000)
                if (!Number.isNaN(fromTs)) {
                    filtered = filtered.filter((p) => p.timestamp >= fromTs)
                }
            }
            if (range?.to) {
                const toTs = Math.floor(new Date(range.to).getTime() / 1000)
                if (!Number.isNaN(toTs)) {
                    filtered = filtered.filter((p) => p.timestamp <= toTs)
                }
            }
            return [asset, filtered] as const
        }),
    )
    return Object.fromEntries(entries)
}
