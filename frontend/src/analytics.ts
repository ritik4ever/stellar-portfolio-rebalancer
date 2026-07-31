const OPT_OUT_KEY = 'analytics-opt-out'

type UmamiApi = { track: (event: string, data?: Record<string, unknown>) => void }

function analyticsActive(): boolean {
    if (import.meta.env.VITE_DEMO_MODE === 'true') return false
    if (import.meta.env.VITE_ANALYTICS_ENABLED !== 'true') return false
    try {
        if (localStorage.getItem(OPT_OUT_KEY) === 'true') return false
    } catch { /* ignore */ }
    return true
}

export function getAnalyticsOptOut(): boolean {
    try {
        return localStorage.getItem(OPT_OUT_KEY) === 'true'
    } catch {
        return false
    }
}

export function setAnalyticsOptOut(value: boolean): void {
    try {
        if (value) {
            localStorage.setItem(OPT_OUT_KEY, 'true')
        } else {
            localStorage.removeItem(OPT_OUT_KEY)
        }
    } catch { /* ignore */ }
}

function umamiInstance(): UmamiApi | null {
    return (window as unknown as { umami?: UmamiApi }).umami ?? null
}

export function initAnalytics(): void {
    if (!analyticsActive()) return

    const analyticsUrl = import.meta.env.VITE_ANALYTICS_URL as string | undefined
    const siteId = import.meta.env.VITE_ANALYTICS_SITE_ID as string | undefined

    if (!analyticsUrl || !siteId) return
    if (document.querySelector(`script[data-website-id="${siteId}"]`)) return

    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.src = `${analyticsUrl}/script.js`
    script.setAttribute('data-website-id', siteId)
    // Manual tracking only — we call track() ourselves for full control
    script.setAttribute('data-auto-track', 'false')
    document.head.appendChild(script)
}

export function trackPageView(page: string): void {
    if (!analyticsActive()) return
    umamiInstance()?.track('pageview', { url: page })
}

export function trackEvent(name: string, props?: Record<string, string | number | boolean>): void {
    if (!analyticsActive()) return
    umamiInstance()?.track(name, props)
}
