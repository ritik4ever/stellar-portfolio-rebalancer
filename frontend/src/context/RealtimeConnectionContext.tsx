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

export type RealtimeConnectionContextValue = {
    state: RealtimeConnectionState
    statusDetail: string | null
    reconnectInfo: RealtimeReconnectInfo | null
    reconnect: () => void
    disconnect: () => void
    send: (type: string, payload: unknown) => boolean
}

const RealtimeConnectionContext = createContext<RealtimeConnectionContextValue | null>(null)

export function RealtimeConnectionProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<RealtimeConnectionState>('disconnected')
    const [statusDetail, setStatusDetail] = useState<string | null>(null)
    const [reconnectInfo, setReconnectInfo] = useState<RealtimeReconnectInfo | null>(null)
    const clientRef = useRef<RebalancerWSClient | null>(null)

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

    const value = useMemo(
        () => ({ state, statusDetail, reconnectInfo, reconnect, disconnect, send }),
        [state, statusDetail, reconnectInfo, reconnect, disconnect, send],
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
