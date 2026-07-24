import { useEffect, useState, useRef } from 'react'
import { getWebSocketUrl } from '../config/api'
import { getAccessToken } from '../services/authService'

export type LiveFeedState = 'disconnected' | 'connecting' | 'connected' | 'error'

export function usePortfolioLiveFeed(portfolioId: string | null) {
    const [connectionState, setConnectionState] = useState<LiveFeedState>('disconnected')
    const [lastPricesTick, setLastPricesTick] = useState<Record<string, any> | null>(null)
    const wsRef = useRef<WebSocket | null>(null)

    useEffect(() => {
        if (!portfolioId) {
            setConnectionState('disconnected')
            return
        }

        const token = getAccessToken()
        if (!token) {
            setConnectionState('error')
            return
        }

        const connect = () => {
            if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
                return
            }

            setConnectionState('connecting')
            
            const baseUrl = getWebSocketUrl()
            // Construct correct portfolio feed URL
            const url = new URL(`${baseUrl}/ws/portfolio/${portfolioId}`)
            url.searchParams.set('token', token)

            const ws = new WebSocket(url.toString())
            wsRef.current = ws

            ws.onopen = () => {
                setConnectionState('connected')
            }

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data)
                    if (data.type === 'HEARTBEAT') {
                        // send PING back
                        ws.send(JSON.stringify({ type: 'PING' }))
                    } else if (data.type === 'PORTFOLIO_VALUE_UPDATE') {
                        setLastPricesTick(data.prices)
                    }
                } catch (e) {
                    console.error('Failed to parse portfolio WS message', e)
                }
            }

            ws.onclose = () => {
                setConnectionState('disconnected')
                wsRef.current = null
                // Wait and try reconnect
                setTimeout(connect, 5000)
            }

            ws.onerror = () => {
                setConnectionState('error')
            }
        }

        connect()

        return () => {
            if (wsRef.current) {
                wsRef.current.close()
                wsRef.current = null
            }
        }
    }, [portfolioId])

    return {
        connectionState,
        lastPricesTick
    }
}
