import { API_CONFIG, ENDPOINTS, type ApiErrorPayload, type ApiEnvelope } from '../config/api'
import { walletManager } from '../utils/walletManager'

export interface AdminRequestOptions extends RequestInit {
    data?: unknown
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
    if (!value || typeof value !== 'object') return false
    const envelope = value as Record<string, unknown>
    return typeof envelope.success === 'boolean' && 'data' in envelope
}

async function getAdminHeaders(): Promise<Record<string, string>> {
    const publicKey = walletManager.getPublicKey()
    if (!publicKey) {
        throw new Error('Wallet not connected')
    }

    const timestamp = Date.now().toString()
    const signature = await walletManager.signMessage(timestamp)

    return {
        'x-public-key': publicKey,
        'x-message': timestamp,
        'x-signature': signature,
    }
}

async function handleAdminResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        return null
    }

    const body = await response.json()

    if (!response.ok) {
        const envelope = isApiEnvelope(body) ? body : null
        const errorPayload = envelope?.error || body?.error
        const message =
            (errorPayload && typeof errorPayload === 'object' && 'message' in errorPayload
                ? (errorPayload as ApiErrorPayload).message
                : undefined) ||
            body?.message ||
            `HTTP ${response.status}: ${response.statusText}`
        const code =
            (errorPayload && typeof errorPayload === 'object' && 'code' in errorPayload
                ? (errorPayload as ApiErrorPayload).code
                : undefined) ||
            body?.error?.code ||
            'HTTP_ERROR'
        throw new Error(`${code}: ${message}`)
    }

    const envelope = isApiEnvelope(body) ? body : null
    if (envelope && !envelope.success) {
        const message = envelope.error?.message || `HTTP ${response.status}: ${response.statusText}`
        throw new Error(message)
    }

    return envelope ? envelope.data : body
}

export async function adminRequest<T>(
    endpoint: string,
    options: AdminRequestOptions = {}
): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${API_CONFIG.BASE_URL}${endpoint}`
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
    }

    const adminHeaders = await getAdminHeaders()
    Object.assign(headers, adminHeaders)

    const body = options.data ? JSON.stringify(options.data) : undefined
    const method = options.method || 'GET'

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT)

    try {
        const response = await fetch(url, {
            ...options,
            method,
            headers,
            body,
            signal: controller.signal,
            mode: 'cors',
            credentials: 'omit',
        })
        clearTimeout(timeoutId)
        return handleAdminResponse(response) as Promise<T>
    } catch (error) {
        clearTimeout(timeoutId)
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timeout after ${API_CONFIG.TIMEOUT}ms`)
        }
        throw error
    }
}

export function isAdminError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const message = error.message
    return (
        message.includes('FORBIDDEN') ||
        message.includes('UNAUTHORIZED') ||
        message.includes('403') ||
        message.includes('401')
    )
}
