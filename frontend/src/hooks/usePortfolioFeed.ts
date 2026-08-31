import { useEffect, useRef, useState, useCallback } from 'react'
import { useRealtimeConnection } from '../context/RealtimeConnectionContext'

interface PriceData {
    price: number
    change: number
    timestamp: number
    source?: string
    quoteAgeSeconds?: number
    servedFromCache?: boolean
    dataTier?: string
}

interface PriceFeedMeta {
    provider: string
    resolvedAtMs: number
    degraded: boolean
    staleOrLimited: boolean
    assetsCount: number
}

interface PricesMap {
    [asset: string]: PriceData
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

interface PortfolioFeedState {
    prices: PricesMap
    feedMeta: PriceFeedMeta | null
    connectionState: ConnectionState
    lastUpdated: Date | null
}

interface UsePortfolioFeedOptions {
    pollingIntervalMs?: number
    pollingFallback?: boolean
}

const DEFAULT_POLLING_INTERVAL = 30_000

const POLLING_API_PATH = '/api/v1/prices'

export function usePortfolioFeed(options: UsePortfolioFeedOptions = {}) {
    const { pollingIntervalMs = DEFAULT_POLLING_INTERVAL, pollingFallback = true } = options
    const [prices, setPrices] = useState<PricesMap>({})
    const [feedMeta, setFeedMeta] = useState<PriceFeedMeta | null>(null)
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

    const { state: wsState, addMessageListener } = useRealtimeConnection()
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        if (wsState === 'connected') {
            setConnectionState('connected')
        } else if (wsState === 'disconnected') {
            setConnectionState('disconnected')
        } else if (wsState === 'reconnecting') {
            setConnectionState('reconnecting')
        } else if (wsState === 'connecting') {
            setConnectionState('connecting')
        }
    }, [wsState])

    useEffect(() => {
        const removeListener = addMessageListener((data) => {
            if (data.type === 'PRICE_UPDATE' && data.payload) {
                const payload = data.payload as { prices?: PricesMap; feedMeta?: PriceFeedMeta }
                if (payload.prices) {
                    setPrices(payload.prices)
                    setLastUpdated(new Date())
                }
                if (payload.feedMeta) {
                    setFeedMeta(payload.feedMeta)
                }
            }
        })
        return removeListener
    }, [addMessageListener])

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }, [])

    const startPolling = useCallback(() => {
        if (pollingRef.current) return
        pollingRef.current = setInterval(async () => {
            try {
                const { default: api } = await import('../config/api')
                const data = await api.get<{ prices: PricesMap; feedMeta?: PriceFeedMeta }>(POLLING_API_PATH)
                if (data && typeof data === 'object') {
                    const d = data as unknown as { prices?: PricesMap; feedMeta?: PriceFeedMeta }
                    if (d.prices) setPrices(d.prices)
                    if (d.feedMeta) setFeedMeta(d.feedMeta)
                    setLastUpdated(new Date())
                }
            } catch {
                // polling fallback failed silently
            }
        }, pollingIntervalMs)
    }, [pollingIntervalMs])

    useEffect(() => {
        if (wsState === 'connected' || !pollingFallback) {
            stopPolling()
            return
        }
        startPolling()
        return stopPolling
    }, [wsState, pollingFallback, startPolling, stopPolling])

    useEffect(() => {
        return () => stopPolling()
    }, [stopPolling])

    return {
        prices,
        feedMeta,
        connectionState,
        lastUpdated,
        hasLiveData: Object.keys(prices).length > 0,
    }
}
