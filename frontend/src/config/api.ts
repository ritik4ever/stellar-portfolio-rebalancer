import { browserPriceService } from '../services/browserPriceService'
import { getAccessToken, refresh } from '../services/authService'
import {
    debugLog,
    getFrontendDebugConfig,
    logApiRequest,
    logApiResponse,
} from '../utils/debug'
import { getApiResourceRoot } from './apiVersion'

/** Resolved once at load; see `getApiResourceRoot` and `frontend/src/config/apiVersion.ts`. */
export const API_RESOURCE_ROOT = getApiResourceRoot()

export interface ApiErrorPayload {
    code: string
    message: string
    details?: unknown
}

export interface ApiEnvelope<T> {
    success: boolean
    data: T | null
    error: ApiErrorPayload | null
    timestamp: string
    meta?: Record<string, unknown>
}

export class ApiClientError extends Error {
    status: number
    code: string
    details?: unknown

    constructor(message: string, status: number, code: string, details?: unknown) {
        super(message)
        this.name = 'ApiClientError'
        this.status = status
        this.code = code
        this.details = details
    }
}

const getBaseUrl = (): string => {
    // In Vite, environment variables need VITE_ prefix to be available in browser
    const viteEnv = (import.meta as any).env
    if (viteEnv?.VITE_API_URL) {
        return viteEnv.VITE_API_URL
    }

    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname
        const isDev = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')

        if (isDev) {
            return 'http://localhost:3001'
        }

        // Production fallback
        return 'https://stellar-portfolio-rebalancer.onrender.com'
    }

    // Server-side fallback
    const isProd = viteEnv?.PROD
    return isProd
        ? 'https://stellar-portfolio-rebalancer.onrender.com'
        : 'http://localhost:3001'
}

/**
 * Determines if browser-side price fetching should be used.
 * 
 * Environment-aware fallback strategy:
 * - Production: Disabled (always use backend prices) unless VITE_ENABLE_BROWSER_PRICE_DEBUG=true
 * - Development: Enabled (prefer browser prices, fallback to backend on error)
 * - Demo mode: Can be enabled via VITE_ENABLE_BROWSER_PRICE_DEBUG flag
 * 
 * This prevents silent backend failures in production while allowing convenience in development.
 */
function shouldUseBrowserPrices(): boolean {
    const viteEnv = (import.meta as any).env
    
    // Explicit debug flag allows browser prices even in production
    if (viteEnv?.VITE_ENABLE_BROWSER_PRICE_DEBUG === 'true') {
        debugLog('Browser price fallback enabled via debug flag')
        return true
    }
    
    // Production: default to backend (prefer explicit backend prices)
    if (viteEnv?.PROD === true || viteEnv?.MODE === 'production') {
        debugLog('Browser price fallback disabled in production (use backend prices)')
        return false
    }
    
    // Development: default to browser prices
    debugLog('Browser price fallback enabled in development')
    return true
}

export const API_CONFIG = {
    BASE_URL: getBaseUrl(),
    WEBSOCKET_URL: getBaseUrl().replace(/^http/, 'ws'),

    /**
     * Environment-aware price fallback strategy.
     * - Production: false (always use backend prices)
     * - Development: true (prefer browser prices, fallback to backend on error)
     * - Demo/Debug mode: true if VITE_ENABLE_BROWSER_PRICE_DEBUG=true
     */
    USE_BROWSER_PRICES: shouldUseBrowserPrices(),

    TIMEOUT: 15000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,

    ENDPOINTS: {
        HEALTH: '/health',
        READINESS: '/readiness',
        ROOT: '/',
        /** Versionless auth namespace (matches backend `app.use('/api/auth', authRouter)`) */
        AUTH_LOGIN: '/api/auth/login',
        AUTH_REFRESH: '/api/auth/refresh',
        AUTH_LOGOUT: '/api/auth/logout',
        PORTFOLIO: `${API_RESOURCE_ROOT}/portfolio`,
        USER_PORTFOLIOS: (address: string) => `${API_RESOURCE_ROOT}/user/${address}/portfolios`,
        PORTFOLIO_DETAIL: (id: string) => `${API_RESOURCE_ROOT}/portfolio/${id}`,
        PORTFOLIO_EXPORT: (id: string, format: 'json' | 'csv' | 'pdf') =>
            `${API_RESOURCE_ROOT}/portfolio/${id}/export?format=${format}`,
        PORTFOLIO_REBALANCE: (id: string) => `${API_RESOURCE_ROOT}/portfolio/${id}/rebalance`,
        PORTFOLIO_REBALANCE_ESTIMATE: (id: string) => `${API_RESOURCE_ROOT}/portfolio/${id}/rebalance-estimate`,
        PORTFOLIO_REBALANCE_STATUS: (id: string) => `${API_RESOURCE_ROOT}/portfolio/${id}/rebalance-status`,
        PORTFOLIO_ANALYTICS: (id: string, days: number) =>
            `${API_RESOURCE_ROOT}/portfolio/${id}/analytics?days=${days}`,
        PORTFOLIO_PERFORMANCE_SUMMARY: (id: string) =>
            `${API_RESOURCE_ROOT}/portfolio/${id}/performance-summary`,
        PRICES: `${API_RESOURCE_ROOT}/prices`,
        PRICES_ENHANCED: `${API_RESOURCE_ROOT}/prices/enhanced`,
        MARKET_DETAILS: (asset: string) => `${API_RESOURCE_ROOT}/market/${asset}/details`,
        PRICE_CHART: (asset: string) => `${API_RESOURCE_ROOT}/market/${asset}/chart`,
        REBALANCE_HISTORY: `${API_RESOURCE_ROOT}/rebalance/history`,
        REBALANCE_RECORD: `${API_RESOURCE_ROOT}/rebalance/history`,
        STRATEGIES: `${API_RESOURCE_ROOT}/strategies`,
        ASSETS: `${API_RESOURCE_ROOT}/assets`,
        RISK_METRICS: (portfolioId: string) => `${API_RESOURCE_ROOT}/risk/metrics/${portfolioId}`,
        RISK_CHECK: (portfolioId: string) => `${API_RESOURCE_ROOT}/risk/check/${portfolioId}`,
        NOTIFICATIONS_PREFERENCES: `${API_RESOURCE_ROOT}/notifications/preferences`,
        NOTIFICATIONS_SUBSCRIBE: `${API_RESOURCE_ROOT}/notifications/subscribe`,
        NOTIFICATIONS_UNSUBSCRIBE: (userId: string) =>
            `${API_RESOURCE_ROOT}/notifications/unsubscribe?userId=${encodeURIComponent(userId)}`,
        NOTIFICATIONS_TEST: `${API_RESOURCE_ROOT}/notifications/test`,
        NOTIFICATIONS_TEST_ALL: `${API_RESOURCE_ROOT}/notifications/test-all`,
        TEST_CORS: '/test/cors',
        TEST_COINGECKO: '/test/coingecko',
        CONSENT_STATUS: `${API_RESOURCE_ROOT}/consent/status`,
        CONSENT_RECORD: `${API_RESOURCE_ROOT}/consent`,
        USER_DATA_DELETE: (address: string) => `${API_RESOURCE_ROOT}/user/${address}/data`,
    }
}

export function getWebSocketUrl(): string {
    const viteEnv = (import.meta as any).env
    const fromEnv = typeof viteEnv?.VITE_WS_URL === 'string' ? viteEnv.VITE_WS_URL.trim() : ''
    if (fromEnv) return fromEnv
    const base = API_CONFIG.WEBSOCKET_URL.replace(/\/$/, '')
    const path = typeof viteEnv?.VITE_WS_PATH === 'string' ? viteEnv.VITE_WS_PATH.trim() : ''
    if (!path) return base
    return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}

const viteEnv = (import.meta as any).env
debugLog('API Configuration', {
    baseUrl: API_CONFIG.BASE_URL,
    apiResourceRoot: API_RESOURCE_ROOT,
    isDev: getFrontendDebugConfig(viteEnv).isDevelopment,
    envApiUrl: viteEnv?.VITE_API_URL,
    mode: viteEnv?.MODE,
})

export const createApiUrl = (endpoint: string, params?: Record<string, string>): string => {
    let url = `${API_CONFIG.BASE_URL}${endpoint}`
    if (params) {
        const searchParams = new URLSearchParams(params)
        url += `?${searchParams.toString()}`
    }
    return url
}

// Enhanced fetch wrapper with better error handling
export const apiRequest = async <T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0
): Promise<T> => {
    // Special handling for prices endpoint - use browser service (if enabled)
    if (API_CONFIG.USE_BROWSER_PRICES && endpoint.includes('/prices') && !endpoint.includes('enhanced')) {
        debugLog('Price source strategy: Browser prices enabled (development mode or debug flag)', {
            endpoint,
            isDev: !((import.meta as any).env?.PROD === true || (import.meta as any).env?.MODE === 'production'),
            debugFlagEnabled: (import.meta as any).env?.VITE_ENABLE_BROWSER_PRICE_DEBUG === 'true'
        })
        try {
            const payload = await browserPriceService.getCurrentPrices()
            return payload as unknown as T
        } catch (error) {
            console.error('Browser price service failed, falling back to backend:', error)
            debugLog('Price fallback triggered: Attempting backend API')
            // Fall through to backend call
        }
    } else if (endpoint.includes('/prices') && !endpoint.includes('enhanced')) {
        debugLog('Price source strategy: Backend prices (production mode or browser fallback disabled)', {
            isDev: !((import.meta as any).env?.PROD === true || (import.meta as any).env?.MODE === 'production'),
            browserPricesWouldBeEnabled: shouldUseBrowserPrices()
        })
    }

    const url = endpoint.startsWith('http') ? endpoint : `${API_CONFIG.BASE_URL}${endpoint}`
    const isApiRequest = url.includes('/api/')

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }

    const accessToken = getAccessToken()
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
    }

    // Add origin header only in browser context
    if (typeof window !== 'undefined') {
        headers['Origin'] = window.location.origin
    }

    // Merge with any custom headers
    if (options.headers) {
        Object.assign(headers, options.headers)
    }

    const defaultOptions: RequestInit = {
        headers,
        mode: 'cors',
        credentials: 'omit', // Changed from 'include' to avoid CORS issues
        ...options,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT)
    defaultOptions.signal = controller.signal

    try {
        logApiRequest(`API Request: ${options.method || 'GET'} ${url}`, {
            headers,
            body: defaultOptions.body,
        }, viteEnv)

        const response = await fetch(url, defaultOptions)
        clearTimeout(timeoutId)

        logApiResponse(`API Response: ${response.status} ${response.statusText}`, {
            status: response.status,
            headers: response.headers,
        }, viteEnv)

        const contentType = response.headers.get('content-type')
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text()
            return text as unknown as T
        }

        const body = await response.json()
        logApiResponse('API Response Data', {
            status: response.status,
            body,
        }, viteEnv)

        // Track backend price source for prices endpoint
        if (endpoint.includes('/prices') && !endpoint.includes('enhanced')) {
            debugLog('Price source: Backend API', {
                endpoint,
                assets: body?.data ? Object.keys(body.data) : 'unknown',
                hasMeta: !!body?.meta
            })
        }

        if (response.status === 401 && retryCount === 0 && isApiRequest) {
            const refreshed = await refresh()
            if (refreshed) {
                return apiRequest<T>(endpoint, options, retryCount + 1)
            }
        }

        if (isApiRequest) {
            const envelope = body as ApiEnvelope<T>

            if (!response.ok || !envelope.success || envelope.data === null) {
                const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`
                const message = envelope.error?.message || fallbackMessage
                const code = envelope.error?.code || (response.ok ? 'INTERNAL_ERROR' : 'HTTP_ERROR')
                throw new ApiClientError(message, response.status, code, envelope.error?.details)
            }

            return envelope.data
        }

        if (!response.ok) {
            const errorMessage = (body?.error?.message || body?.error || body?.message || `HTTP ${response.status}: ${response.statusText}`) as string
            throw new ApiClientError(errorMessage, response.status, 'HTTP_ERROR')
        }

        return body as T
    } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                console.error(`API Request timeout: ${url}`)
                throw new ApiClientError(`Request timeout after ${API_CONFIG.TIMEOUT}ms`, 408, 'REQUEST_TIMEOUT')
            }

            console.error(`API Request failed: ${url}`, error.message)

            // Retry logic (not for browser price service)
            if (retryCount < API_CONFIG.RETRY_ATTEMPTS &&
                !endpoint.includes('/prices') &&
                (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('Failed to fetch'))) {
                debugLog(`Retrying request (${retryCount + 1}/${API_CONFIG.RETRY_ATTEMPTS})...`, {
                    url,
                })
                await new Promise(resolve => setTimeout(resolve, API_CONFIG.RETRY_DELAY * (retryCount + 1)))
                return apiRequest<T>(endpoint, options, retryCount + 1)
            }
        }

        throw error
    }
}

// Convenience methods for common HTTP verbs
export const api = {
    get: <T>(endpoint: string, params?: Record<string, string>): Promise<T> => {
        const url = params ? createApiUrl(endpoint, params) : endpoint
        return apiRequest<T>(url, { method: 'GET' })
    },

    post: <T>(endpoint: string, data?: any): Promise<T> => {
        return apiRequest<T>(endpoint, {
            method: 'POST',
            body: data ? JSON.stringify(data) : undefined,
        })
    },

    put: <T>(endpoint: string, data?: any): Promise<T> => {
        return apiRequest<T>(endpoint, {
            method: 'PUT',
            body: data ? JSON.stringify(data) : undefined,
        })
    },

    delete: <T>(endpoint: string): Promise<T> => {
        return apiRequest<T>(endpoint, { method: 'DELETE' })
    }
}

/** Fetch export file (JSON/CSV/PDF) and trigger download. Uses blob response and Content-Disposition filename. */
export const downloadPortfolioExport = async (
    portfolioId: string,
    format: 'json' | 'csv' | 'pdf'
): Promise<void> => {
    const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PORTFOLIO_EXPORT(portfolioId, format)}`
    const headers: Record<string, string> = { Accept: format === 'pdf' ? 'application/pdf' : 'application/json, text/csv' }
    const token = getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(url, { method: 'GET', headers, credentials: 'omit' })

    if (res.status === 401) {
        const refreshed = await refresh()
        if (refreshed) return downloadPortfolioExport(portfolioId, format)
        throw new ApiClientError('Unauthorized', 401, 'UNAUTHORIZED')
    }

    if (!res.ok) {
        const text = await res.text()
        let message = `Export failed: ${res.status}`
        try {
            const json = JSON.parse(text)
            message = json?.error?.message || json?.message || message
        } catch {
            if (text) message = text.slice(0, 200)
        }
        throw new ApiClientError(message, res.status, 'EXPORT_FAILED')
    }

    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition')
    const match = disposition?.match(/filename="?([^";\n]+)"?/)
    const filename = match?.[1] ?? `portfolio_export_${new Date().toISOString().slice(0, 10)}.${format === 'pdf' ? 'pdf' : format === 'csv' ? 'csv' : 'json'}`
    const { downloadBlob } = await import('../utils/export')
    downloadBlob(filename, blob)
}

// Direct price fetching function
export const fetchPricesDirectly = async () => {
    try {
        return await browserPriceService.getCurrentPrices()
    } catch (error) {
        console.error('Direct price fetch failed:', error)
        throw error
    }
}

// Test functions
export const testBrowserPrices = async (): Promise<boolean> => {
    try {
        debugLog('Testing browser price service...')
        const testResult = await browserPriceService.testConnection()
        debugLog('Browser price test result', testResult)
        return testResult.success
    } catch (error) {
        console.error('Browser price test failed:', error)
        return false
    }
}

export const ENDPOINTS = API_CONFIG.ENDPOINTS
export default API_CONFIG
