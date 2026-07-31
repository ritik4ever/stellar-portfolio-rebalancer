import { useEffect, useState, useRef, useCallback } from 'react'
import { getWebSocketUrl } from '../config/api'
import { getAccessToken } from '../services/authService'

export type LiveFeedStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/** Minimum delay (ms) before the first reconnect attempt. */
export const BACKOFF_BASE_MS = 1_000

/** Maximum delay (ms) between reconnect attempts. */
export const BACKOFF_MAX_MS = 30_000

/** Multiplier applied to the delay after each failed attempt. */
export const BACKOFF_MULTIPLIER = 2

export function usePortfolioLiveFeed(portfolioId: string | null) {
    const [status, setStatus] = useState<LiveFeedStatus>('disconnected')
    const [lastPricesTick, setLastPricesTick] = useState<Record<string, any> | null>(null)

    const wsRef = useRef<WebSocket | null>(null)
    const retryCountRef = useRef<number>(0)
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** Track whether the effect is still mounted so we skip stale callbacks. */
    const mountedRef = useRef<boolean>(false)

    const clearRetryTimer = useCallback(() => {
        if (retryTimerRef.current !== null) {
            clearTimeout(retryTimerRef.current)
            retryTimerRef.current = null
        }
    }, [])

    const closeSocket = useCallback(() => {
        if (wsRef.current) {
            // Remove handlers before closing so onclose doesn't schedule a retry.
            wsRef.current.onopen = null
            wsRef.current.onmessage = null
            wsRef.current.onclose = null
            wsRef.current.onerror = null
            wsRef.current.close()
            wsRef.current = null
        }
    }, [])

    useEffect(() => {
        mountedRef.current = true

        if (!portfolioId) {
            setStatus('disconnected')
            return () => {
                mountedRef.current = false
            }
        }

        const token = getAccessToken()
        if (!token) {
            setStatus('error')
            return () => {
                mountedRef.current = false
            }
        }

        /**
         * Compute the next backoff delay (capped at BACKOFF_MAX_MS) and
         * increment the retry counter.
         */
        const nextBackoffMs = (): number => {
            const delay = Math.min(
                BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, retryCountRef.current),
                BACKOFF_MAX_MS
            )
            retryCountRef.current += 1
            return delay
        }

        const connect = () => {
            if (!mountedRef.current) return

            // Avoid opening a second socket if one is already live.
            if (
                wsRef.current?.readyState === WebSocket.OPEN ||
                wsRef.current?.readyState === WebSocket.CONNECTING
            ) {
                return
            }

            setStatus(retryCountRef.current === 0 ? 'connecting' : 'reconnecting')

            const baseUrl = getWebSocketUrl()
            const url = new URL(`${baseUrl}/ws/portfolio/${portfolioId}`)
            url.searchParams.set('token', token)

            const ws = new WebSocket(url.toString())
            wsRef.current = ws

            ws.onopen = () => {
                if (!mountedRef.current) return
                // Successful connection — reset the backoff counter.
                retryCountRef.current = 0
                setStatus('connected')
            }

            ws.onmessage = (event) => {
                if (!mountedRef.current) return
                try {
                    const data = JSON.parse(event.data)
                    if (data.type === 'HEARTBEAT') {
                        ws.send(JSON.stringify({ type: 'PING' }))
                    } else if (data.type === 'PORTFOLIO_VALUE_UPDATE') {
                        setLastPricesTick(data.prices)
                    }
                } catch (e) {
                    console.error('Failed to parse portfolio WS message', e)
                }
            }

            ws.onclose = () => {
                if (!mountedRef.current) return
                wsRef.current = null
                setStatus('reconnecting')

                const delay = nextBackoffMs()
                retryTimerRef.current = setTimeout(() => {
                    if (mountedRef.current) connect()
                }, delay)
            }

            ws.onerror = () => {
                if (!mountedRef.current) return
                setStatus('error')
            }
        }

        connect()

        return () => {
            mountedRef.current = false
            clearRetryTimer()
            closeSocket()
        }
    }, [portfolioId, clearRetryTimer, closeSocket])

    return {
        /** Current WebSocket connection status. */
        status,
        /**
         * @deprecated Use `status` instead.
         * Kept for backward-compatibility with components that read `connectionState`.
         */
        connectionState: status,
        lastPricesTick,
    }
}
