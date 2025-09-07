// API Configuration with environment detection
const getBaseUrl = (): string => {
    // Check if we're in development
    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname
        const isDev = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')

        if (isDev) {
            // Try to detect if backend is running on different port
            const currentPort = window.location.port
            if (currentPort === '3000' || currentPort === '5173') {
                return 'http://localhost:3001'  // Default backend port
            }
            return `http://localhost:3001`  // Always use 3001 for backend in dev
        }

        // Production environment
        return 'https://stellar-portfolio-rebalancer.onrender.com'
    }

    // Fallback for SSR or non-browser environments
    return process.env.NODE_ENV === 'production'
        ? 'https://stellar-portfolio-rebalancer.onrender.com'
        : 'http://localhost:3001'
}

export const API_CONFIG = {
    BASE_URL: getBaseUrl(),
    WEBSOCKET_URL: getBaseUrl().replace('http', 'ws'),

    // Request timeout settings
    TIMEOUT: 10000, // 10 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second

    // Endpoints
    ENDPOINTS: {
        // Basic endpoints
        HEALTH: '/health',
        ROOT: '/',

        // Portfolio endpoints
        PORTFOLIO: '/portfolio',
        USER_PORTFOLIOS: (address: string) => `/user/${address}/portfolios`,
        PORTFOLIO_DETAIL: (id: string) => `/portfolio/${id}`,
        PORTFOLIO_REBALANCE: (id: string) => `/portfolio/${id}/rebalance`,
        PORTFOLIO_REBALANCE_STATUS: (id: string) => `/portfolio/${id}/rebalance-status`,

        // Price endpoints
        PRICES: '/prices',
        PRICES_ENHANCED: '/api/prices/enhanced',
        MARKET_DETAILS: (asset: string) => `/market/${asset}/details`,
        PRICE_CHART: (asset: string) => `/market/${asset}/chart`,

        // Rebalance history endpoints
        REBALANCE_HISTORY: '/api/rebalance/history',
        REBALANCE_RECORD: '/api/rebalance/history',

        // Risk management endpoints
        RISK_METRICS: (portfolioId: string) => `/api/risk/metrics/${portfolioId}`,
        RISK_CHECK: (portfolioId: string) => `/api/risk/check/${portfolioId}`,
    }
}

// Utility functions for API calls
export const createApiUrl = (endpoint: string, params?: Record<string, string>): string => {
    let url = `${API_CONFIG.BASE_URL}${endpoint}`

    if (params) {
        const searchParams = new URLSearchParams(params)
        url += `?${searchParams.toString()}`
    }

    return url
}

// Enhanced fetch wrapper with retry logic and error handling
export const apiRequest = async <T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0
): Promise<T> => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_CONFIG.BASE_URL}${endpoint}`

    const defaultOptions: RequestInit = {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers,
        },
        ...options,
    }

    // Add timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT)
    defaultOptions.signal = controller.signal

    try {
        console.log(`API Request: ${options.method || 'GET'} ${url}`)

        const response = await fetch(url, defaultOptions)
        clearTimeout(timeoutId)

        // Log response details
        console.log(`API Response: ${response.status} ${response.statusText}`)

        if (!response.ok) {
            // Try to get error message from response
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`
            try {
                const errorData = await response.json()
                errorMessage = errorData.error || errorData.message || errorMessage
            } catch {
                // If we can't parse error as JSON, use status text
            }

            throw new Error(errorMessage)
        }

        // Parse response
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json()
            console.log('API Response Data:', data)
            return data
        } else {
            const text = await response.text()
            console.log('API Response Text:', text)
            return text as unknown as T
        }

    } catch (error) {
        clearTimeout(timeoutId)

        // Handle network errors and timeouts
        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                console.error(`API Request timeout: ${url}`)
                throw new Error(`Request timeout after ${API_CONFIG.TIMEOUT}ms`)
            }

            console.error(`API Request failed: ${url}`, error.message)

            // Retry logic for network errors
            if (retryCount < API_CONFIG.RETRY_ATTEMPTS &&
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

// WebSocket connection helper
export const createWebSocketConnection = (onMessage?: (data: any) => void): WebSocket | null => {
    if (typeof window === 'undefined') return null

    try {
        const ws = new WebSocket(API_CONFIG.WEBSOCKET_URL)

        ws.onopen = () => {
            console.log('WebSocket connected to:', API_CONFIG.WEBSOCKET_URL)
        }

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                console.log('WebSocket message received:', data)
                if (onMessage) {
                    onMessage(data)
                }
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error)
            }
        }

        ws.onerror = (error) => {
            console.error('WebSocket error:', error)
        }

        ws.onclose = (event) => {
            console.log('WebSocket disconnected:', event.code, event.reason)
        }

        return ws
    } catch (error) {
        console.error('Failed to create WebSocket connection:', error)
        return null
    }
}

// Health check function
export const checkApiHealth = async (): Promise<boolean> => {
    try {
        const response = await apiRequest<{ status: string }>(API_CONFIG.ENDPOINTS.HEALTH)
        return response.status === 'ok' || response.status === 'healthy'
    } catch (error) {
        console.error('API health check failed:', error)
        return false
    }
}

// Export constants for easy access
export const ENDPOINTS = API_CONFIG.ENDPOINTS
export default API_CONFIG