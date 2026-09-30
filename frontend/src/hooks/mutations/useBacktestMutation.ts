import { useMutation } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export interface BacktestRequest {
    allocations: Record<string, number>
    threshold: number
    days: number
    initialValue?: number
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
    simulated: true
    dataSource: string
    disclaimer: string
}

// A mutation rather than a query: each run hits the upstream price-history
// API, so it should only fire when the user explicitly asks for it.
export const useBacktestMutation = () => {
    return useMutation({
        mutationFn: (request: BacktestRequest) => api.post<BacktestResult>(ENDPOINTS.BACKTEST, request),
    })
}
