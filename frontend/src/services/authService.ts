const STORAGE_KEY_ACCESS = 'auth_access_token'
const STORAGE_KEY_REFRESH = 'auth_refresh_token'
const STORAGE_KEY_EXPIRES = 'auth_expires_at'

const getBaseUrl = (): string => {
    const viteEnv = (import.meta as any).env
    if (viteEnv?.VITE_API_URL) return viteEnv.VITE_API_URL
    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
            return 'http://localhost:3001'
        }
        return 'https://stellar-portfolio-rebalancer.onrender.com'
    }
    return viteEnv?.PROD ? 'https://stellar-portfolio-rebalancer.onrender.com' : 'http://localhost:3001'
}

export interface AuthTokens {
    accessToken: string
    refreshToken: string
    expiresIn: number
    refreshExpiresIn: number
}

let inMemoryAccessToken: string | null = null

export function getAccessToken(): string | null {
    if (inMemoryAccessToken) return inMemoryAccessToken
    if (typeof window !== 'undefined') {
        return localStorage.getItem(STORAGE_KEY_ACCESS)
    }
    return null
}

export function getRefreshToken(): string | null {
    if (typeof window !== 'undefined') {
        return localStorage.getItem(STORAGE_KEY_REFRESH)
    }
    return null
}

export function setTokens(tokens: AuthTokens): void {
    inMemoryAccessToken = tokens.accessToken
    if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_ACCESS, tokens.accessToken)
        localStorage.setItem(STORAGE_KEY_REFRESH, tokens.refreshToken)
        const expiresAt = Date.now() + tokens.expiresIn * 1000
        localStorage.setItem(STORAGE_KEY_EXPIRES, String(expiresAt))
    }
}

export function clearTokens(): void {
    inMemoryAccessToken = null
    if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY_ACCESS)
        localStorage.removeItem(STORAGE_KEY_REFRESH)
        localStorage.removeItem(STORAGE_KEY_EXPIRES)
    }
}

export function isAuthenticated(): boolean {
    return Boolean(getAccessToken() || getRefreshToken())
}

export async function login(address: string): Promise<AuthTokens | null> {
    const baseUrl = getBaseUrl()
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
    })
    if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error?.message || `Login failed: ${res.status}`)
    }
    const envelope = await res.json()
    const data = envelope?.data ?? envelope
    if (!data?.accessToken || !data?.refreshToken) return null
    const tokens: AuthTokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn ?? 900,
        refreshExpiresIn: data.refreshExpiresIn ?? 604800
    }
    setTokens(tokens)
    return tokens
}

export async function refresh(): Promise<boolean> {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return false
    const baseUrl = getBaseUrl()
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
    })
    if (!res.ok) {
        clearTokens()
        return false
    }
    const envelope = await res.json()
    const data = envelope?.data ?? envelope
    if (!data?.accessToken || !data?.refreshToken) {
        clearTokens()
        return false
    }
    setTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn ?? 900,
        refreshExpiresIn: data.refreshExpiresIn ?? 604800
    })
    return true
}

export async function logout(address: string | null): Promise<void> {
    const baseUrl = getBaseUrl()
    const refreshToken = getRefreshToken()
    try {
        if (refreshToken) {
            await fetch(`${baseUrl}/api/auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAccessToken()}`
                },
                body: JSON.stringify({ refreshToken })
            })
        } else if (address) {
            await fetch(`${baseUrl}/api/auth/logout-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address })
            })
        }
    } finally {
        clearTokens()
    }
}
