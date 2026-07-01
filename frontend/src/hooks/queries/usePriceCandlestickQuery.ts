import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

// ── types ──────────────────────────────────────────────────────────────────────

export type CandlestickInterval = '1H' | '4H' | '1D' | '1W'

export interface OHLCVCandle {
    /** Unix timestamp in milliseconds */
    time: number
    open: number
    high: number
    low: number
    close: number
    volume: number
}

export interface PriceChartResponse {
    asset: string
    interval: CandlestickInterval
    candles: OHLCVCandle[]
}

// ── query keys ─────────────────────────────────────────────────────────────────

export const candlestickKeys = {
    all: ['price-chart'] as const,
    asset: (asset: string) => [...candlestickKeys.all, asset] as const,
    chart: (asset: string, interval: CandlestickInterval) =>
        [...candlestickKeys.asset(asset), interval] as const,
}

// ── interval → query param ─────────────────────────────────────────────────────

const INTERVAL_PARAMS: Record<CandlestickInterval, string> = {
    '1H': '1h',
    '4H': '4h',
    '1D': '1d',
    '1W': '1w',
}

// ── hook ───────────────────────────────────────────────────────────────────────

export function usePriceCandlestick(
    asset: string | null,
    interval: CandlestickInterval
) {
    return useQuery({
        queryKey: candlestickKeys.chart(asset ?? '', interval),
        queryFn: async (): Promise<PriceChartResponse> => {
            const raw = await api.get<PriceChartResponse>(
                ENDPOINTS.PRICE_CHART(asset!),
                { interval: INTERVAL_PARAMS[interval] }
            )
            // Normalise: ensure time is ms, sort ascending
            const candles: OHLCVCandle[] = (raw.candles ?? [])
                .map((c: any) => ({
                    time:   typeof c.time === 'number' && c.time < 1e12 ? c.time * 1000 : Number(c.time),
                    open:   Number(c.open),
                    high:   Number(c.high),
                    low:    Number(c.low),
                    close:  Number(c.close),
                    volume: Number(c.volume ?? 0),
                }))
                .filter((c) => Number.isFinite(c.time) && c.high >= c.low)
                .sort((a, b) => a.time - b.time)
            return { asset: raw.asset ?? asset!, interval, candles }
        },
        enabled: !!asset,
        staleTime: 60_000,
        refetchInterval: 60_000,
        placeholderData: (prev) => prev,
    })
}
