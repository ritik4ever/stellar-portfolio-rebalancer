// API Configuration with environment detection and browser price service
import { browserPriceService } from '../services/browserPriceService'

const getBaseUrl = (): string => {
    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname
        const isDev = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')

        if (isDev) {
            const currentPort = window.location.port
            if (currentPort === '3000' || currentPort === '5173') {
                return 'http://localhost:3001'
            }
            return `http://localhost:3001`
        }
        return 'https://stellar-portfolio-rebalancer.onrender.com'
    }
    return process.env.NODE_ENV === 'production'
        ? 'https://stellar-portfolio-rebalancer.onrender.com'
        : 'http://localhost:3001'
}

export const API_CONFIG = {
    BASE_URL: getBaseUrl(),
    WEBSOCKET_URL: getBaseUrl().replace('http', 'ws'),

    // Use browser-based prices to bypass backend API issues
    USE_BROWSER_PRICES: true,

    TIMEOUT: 15000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,

    ENDPOINTS: {
        HEALTH: '/health',
        ROOT: '/',
        PORTFOLIO: '/api/portfolio',
        USER_PORTFOLIOS: (address: string) => `/api/user/${address}/portfolios`,
        PORTFOLIO_DETAIL: (id: string) => `/api/portfolio/${id}`,
        PORTFOLIO_REBALANCE: (id: string) => `/api/portfolio/${id}/rebalance`,
        PORTFOLIO_REBALANCE_STATUS: (id: string) => `/api/portfolio/${id}/rebalance-status`,
        PRICES: '/api/prices',
        PRICES_ENHANCED: '/api/prices/enhanced',
        MARKET_DETAILS: (asset: string) => `/api/market/${asset}/details`,
        PRICE_CHART: (asset: string) => `/api/market/${asset}/chart`,
        REBALANCE_HISTORY: '/api/rebalance/history',
        REBALANCE_RECORD: '/api/rebalance/history',
        RISK_METRICS: (portfolioId: string) => `/api/risk/metrics/${portfolioId}`,
        RISK_CHECK: (portfolioId: string) => `/api/risk/check/${portfolioId}`,
        TEST_CORS: '/test/cors',
        TEST_COINGECKO: '/test/coingecko',
    }
}

export const createApiUrl = (endpoint: string, params?: Record<string, string>): string => {
    let url = `${API_CONFIG.BASE_URL}${endpoint}`
    if (params) {
        const searchParams = new URLSearchParams(params)
        url += `?${searchParams.toString()}`
    }
    return url
}

// Enhanced fetch wrapper that can use browser prices when needed
export const apiRequest = async <T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0
): Promise<T> => {
    // Special handling for prices endpoint - use browser service
    if (API_CONFIG.USE_BROWSER_PRICES && endpoint.includes('/prices') && !endpoint.includes('enhanced')) {
        console.log('Using browser price service instead of backend')
        try {
            const prices = await browserPriceService.getCurrentPrices()
            return prices as unknown as T
        } catch (error) {
            console.error('Browser price service failed, falling back to backend:', error)
            // Fall through to backend call
        }
    }

    const url = endpoint.startsWith('http') ? endpoint : `${API_CONFIG.BASE_URL}${endpoint}`

    const defaultOptions: RequestInit = {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers,
        },
        credentials: 'include',
        mode: 'cors',
        ...options,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT)
    defaultOptions.signal = controller.signal

    try {
        console.log(`API Request: ${options.method || 'GET'} ${url}`)

        const response = await fetch(url, defaultOptions)
        clearTimeout(timeoutId)

        console.log(`API Response: ${response.status} ${response.statusText}`)

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`
            try {
                const errorData = await response.json()
                errorMessage = errorData.error || errorData.message || errorMessage
            } catch {
                // Use status text if can't parse error
            }
            throw new Error(errorMessage)
        }

        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json()
            console.log('API Response Data:', data)
            return data
        } else {
            const text = await response.text()
            return text as unknown as T
        }

    } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                console.error(`API Request timeout: ${url}`)
                throw new Error(`Request timeout after ${API_CONFIG.TIMEOUT}ms`)
            }

            console.error(`API Request failed: ${url}`, error.message)

            // Retry logic (not for browser price service)
            if (retryCount < API_CONFIG.RETRY_ATTEMPTS &&
                !endpoint.includes('/prices') &&
                (error.message.includes('fetch') || error.message.includes('network'))) {
                console.log(`Retrying request (${retryCount + 1}/${API_CONFIG.RETRY_ATTEMPTS})...`)
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
        console.log('Testing browser price service...')
        const testResult = await browserPriceService.testConnection()
        console.log('Browser price test result:', testResult)
        return testResult.success
    } catch (error) {
        console.error('Browser price test failed:', error)
        return false
    }
}

export const ENDPOINTS = API_CONFIG.ENDPOINTS
export default API_CONFIG