/** A trend line needs two points. One point is shown as a dot. */
export const MIN_TREND_POINTS = 2

export type PerformanceSeriesState = 'empty' | 'single' | 'ready'

export interface PerformanceSeriesSummary {
    state: PerformanceSeriesState
    validPoints: number
    incompletePoints: number
}

export function isCompleteSnapshot(snapshot: { timestamp?: unknown; totalValue?: unknown }): boolean {
    const { timestamp, totalValue } = snapshot
    if (totalValue === null || totalValue === undefined || totalValue === '') return false
    if (!Number.isFinite(Number(totalValue))) return false
    if (typeof timestamp !== 'string' && typeof timestamp !== 'number') return false
    return Number.isFinite(new Date(timestamp).getTime())
}

export function summarizePerformanceSeries(
    snapshots: Array<{ timestamp?: unknown; totalValue?: unknown }>,
): PerformanceSeriesSummary {
    const validPoints = snapshots.filter(isCompleteSnapshot).length
    const state: PerformanceSeriesState =
        validPoints === 0 ? 'empty' : validPoints < MIN_TREND_POINTS ? 'single' : 'ready'
    return { state, validPoints, incompletePoints: snapshots.length - validPoints }
}
