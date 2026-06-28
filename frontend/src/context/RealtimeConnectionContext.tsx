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

export type RealtimeConnectionContextValue = {
    state: RealtimeConnectionState
    statusDetail: string | null
    reconnectInfo: RealtimeReconnectInfo | null
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
    const clientRef = useRef<RebalancerWSClient | null>(null)
    const listenersRef = useRef<Set<MessageListener>>(new Set())

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
                listenersRef.current.forEach((listener) => {
                    try {
                        listener(data as Record<string, unknown>)
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

        return () => {
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
        () => ({ state, statusDetail, reconnectInfo, reconnect, disconnect, send, addMessageListener }),
        [state, statusDetail, reconnectInfo, reconnect, disconnect, send, addMessageListener],
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
