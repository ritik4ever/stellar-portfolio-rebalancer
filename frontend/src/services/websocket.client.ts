import { WS_PROTOCOL_VERSION } from '../constants/wsProtocol'

export type RealtimeConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'reconnecting'

export type RebalancerWSOptions = {
    maxReconnectAttempts?: number
    maxBackoffMs?: number
    onStateChange?: (state: RealtimeConnectionState) => void
    onMessage?: (data: unknown) => void
    onStatusDetail?: (detail: string | null) => void
}

const DEFAULT_MAX_ATTEMPTS = 12
const DEFAULT_MAX_BACKOFF_MS = 30_000

export class RebalancerWSClient {
    private ws: WebSocket | null = null
    private readonly url: string
    private readonly maxReconnectAttempts: number
    private readonly maxBackoffMs: number
    private readonly onStateChange?: (state: RealtimeConnectionState) => void
    private readonly onMessage?: (data: unknown) => void
    private readonly onStatusDetail?: (detail: string | null) => void

    private intentionalClose = false
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectCycles = 0

    constructor(url: string, options: RebalancerWSOptions = {}) {
        this.url = url
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_ATTEMPTS
        this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
        this.onStateChange = options.onStateChange
        this.onMessage = options.onMessage
        this.onStatusDetail = options.onStatusDetail
    }

    private setState(state: RealtimeConnectionState): void {
        this.onStateChange?.(state)
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer != null) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
    }

    private scheduleReconnect(): void {
        this.clearReconnectTimer()
        if (this.reconnectCycles >= this.maxReconnectAttempts) {
            this.onStatusDetail?.(
                `Could not restore the live connection after ${this.maxReconnectAttempts} retries.`,
            )
            this.setState('disconnected')
            return
        }
        const base = Math.min(1000 * 2 ** this.reconnectCycles, this.maxBackoffMs)
        const jitter = Math.random() * 400
        const delay = Math.min(base + jitter, this.maxBackoffMs)
        this.onStatusDetail?.(
            `Next retry in ${Math.round(delay / 1000)}s (${this.reconnectCycles + 1}/${this.maxReconnectAttempts})`,
        )
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.reconnectCycles += 1
            this.openSocket()
        }, delay)
    }

    private openSocket(): void {
        if (this.intentionalClose) return
        if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
            return
        }

        this.onStatusDetail?.(null)
        this.setState(this.reconnectCycles === 0 ? 'connecting' : 'reconnecting')

        try {
            this.ws = new WebSocket(this.url)
        } catch {
            this.onStatusDetail?.('Failed to open WebSocket')
            this.scheduleReconnect()
            return
        }

        this.ws.onopen = () => {
            this.reconnectCycles = 0
            this.onStatusDetail?.(null)
            this.setState('connected')
        }

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data as string) as unknown
                this.onMessage?.(data)
            } catch {
                this.onMessage?.(event.data)
            }
        }

        this.ws.onerror = () => {
            this.onStatusDetail?.('WebSocket error')
        }

        this.ws.onclose = () => {
            this.ws = null
            if (this.intentionalClose) {
                this.setState('disconnected')
                return
            }
            this.scheduleReconnect()
        }
    }

    connect(): void {
        this.intentionalClose = false
        this.reconnectCycles = 0
        this.clearReconnectTimer()
        this.openSocket()
    }

    resume(): void {
        this.intentionalClose = false
        this.reconnectCycles = 0
        this.onStatusDetail?.(null)
        this.clearReconnectTimer()
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.setState('connected')
            return
        }
        this.openSocket()
    }

    disconnect(): void {
        this.intentionalClose = true
        this.clearReconnectTimer()
        this.onStatusDetail?.(null)
        if (this.ws) {
            this.ws.close()
            this.ws = null
        }
        this.setState('disconnected')
    }

    send(type: string, payload: unknown): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
        this.ws.send(
            JSON.stringify({
                version: WS_PROTOCOL_VERSION,
                type,
                payload,
                timestamp: Date.now(),
            }),
        )
        return true
    }
}
