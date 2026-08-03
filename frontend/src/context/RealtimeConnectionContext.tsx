import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { getWebSocketUrl } from '../config/api'
import {
    RebalancerWSClient,
    type RealtimeConnectionState,
    type RealtimeReconnectInfo,
} from '../services/websocket.client'

export type MessageListener = (data: Record<string, unknown>) => void

export type ConnectionQuality = 'good' | 'degraded' | 'poor' | 'unknown'

export type RealtimeConnectionContextValue = {
    state: RealtimeConnectionState
    statusDetail: string | null
    reconnectInfo: RealtimeReconnectInfo | null
    quality: ConnectionQuality
    latency: number | null
    reconnect: () => void
    disconnect: () => void
    send: (type: string, payload: unknown) => boolean
    addMessageListener: (listener: MessageListener) => () => void
}

const RealtimeConnectionContext = createContext<RealtimeConnectionContextValue | null>(null)

export function RealtimeConnectionProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<RealtimeConnectionState>('disconnected')
    const [statusDetail, setStatusDetail] = useState<string | null>(null)
    const [reconnectInfo, setReconnectInfo] = useState<RealtimeReconnectInfo | null>(null)
    
    const [latency, setLatency] = useState<number | null>(null)
    const [disconnectHistory, setDisconnectHistory] = useState<number[]>([])

    const clientRef = useRef<RebalancerWSClient | null>(null)
    const listenersRef = useRef<Set<MessageListener>>(new Set())

    // Track state changes for disconnects
    useEffect(() => {
        if (state === 'disconnected' || state === 'reconnecting') {
            setDisconnectHistory((prev) => {
                const now = Date.now()
                const recent = prev.filter(time => now - time < 5 * 60 * 1000)
                return [...recent, now]
            })
        }
    }, [state])

    // Derive quality based on latency and disconnects
    const quality = useMemo<ConnectionQuality>(() => {
        if (state === 'disconnected' || state === 'reconnecting') return 'unknown'
        if (state === 'connecting') return 'unknown'
        
        const now = Date.now()
        const recentDisconnects = disconnectHistory.filter(time => now - time < 60 * 1000).length

        if (recentDisconnects >= 2) return 'poor'
        if (latency !== null) {
            if (latency > 500) return 'poor'
            if (latency > 200) return 'degraded'
            return 'good'
        }
        return 'good'
    }, [latency, disconnectHistory, state])

    useEffect(() => {
        if (typeof WebSocket === 'undefined') {
            setState('disconnected')
            setStatusDetail('WebSocket is not available in this environment.')
            return
        }

        const client = new RebalancerWSClient(getWebSocketUrl(), {
            onStateChange: setState,
            onStatusDetail: setStatusDetail,
            onReconnectInfo: setReconnectInfo,
            onMessage: (data) => {
                const msg = data as Record<string, unknown>
                if (msg.type === 'PONG' && typeof msg.timestamp === 'number') {
                    setLatency(Date.now() - msg.timestamp)
                }

                listenersRef.current.forEach((listener) => {
                    try {
                        listener(msg)
                    } catch {
                        // isolate listener errors
                    }
                })
            },
        })
        clientRef.current = client
        client.connect()

        const onVisibility = () => {
            client.setPaused(document.visibilityState === 'hidden')
        }
        document.addEventListener('visibilitychange', onVisibility)
        onVisibility()

        const pingInterval = setInterval(() => {
            if (clientRef.current?.send) {
                clientRef.current.send('PING', { timestamp: Date.now() })
            }
        }, 5000)

        return () => {
            clearInterval(pingInterval)
            document.removeEventListener('visibilitychange', onVisibility)
            client.disconnect()
            clientRef.current = null
        }
    }, [])

    const reconnect = useCallback(() => {
        clientRef.current?.resume()
    }, [])

    const disconnect = useCallback(() => {
        clientRef.current?.disconnect()
    }, [])

    const send = useCallback((type: string, payload: unknown) => {
        return clientRef.current?.send(type, payload) ?? false
    }, [])

    const addMessageListener = useCallback((listener: MessageListener) => {
        listenersRef.current.add(listener)
        return () => {
            listenersRef.current.delete(listener)
        }
    }, [])

    const value = useMemo(
        () => ({ state, statusDetail, reconnectInfo, quality, latency, reconnect, disconnect, send, addMessageListener }),
        [state, statusDetail, reconnectInfo, quality, latency, reconnect, disconnect, send, addMessageListener],
    )

    return (
        <RealtimeConnectionContext.Provider value={value}>
            {children}
        </RealtimeConnectionContext.Provider>
    )
}

export function useRealtimeConnection(): RealtimeConnectionContextValue {
    const ctx = useContext(RealtimeConnectionContext)
    if (!ctx) {
        throw new Error('useRealtimeConnection must be used within RealtimeConnectionProvider')
    }
    return ctx
}
