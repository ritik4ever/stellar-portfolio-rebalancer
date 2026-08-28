import { logger } from '../utils/logger.js'
import type { Request, Response } from 'express'

interface RateLimitMetrics {
    totalRequests: number
    throttledRequests: number
    throttledByType: Record<string, number>
    throttledByEndpoint: Record<string, number>
    throttledByIP: Record<string, number>
    throttledByUser: Record<string, number>
    lastReset: Date
}

// ── consumption tracking (dashboard) ───────────────────────────────────────────

export type RateLimitIdentifierType = 'ip' | 'apiKey'

/** ok → below the near-limit ratio, near-limit → at/above it, throttled → already 429'd this window. */
export type RateLimitStatus = 'ok' | 'near-limit' | 'throttled'

export interface RateLimitConsumptionEntry {
    identifier: string
    type: RateLimitIdentifierType
    consumed: number
    limit: number
    remaining: number
    /** Fraction of the limit consumed, 0–1+, rounded to 4 decimals. */
    utilization: number
    throttledCount: number
    status: RateLimitStatus
    windowStartedAt: string
    windowResetsAt: string
    lastSeenAt: string
}

export interface RateLimitDashboardQuery {
    type?: RateLimitIdentifierType | 'all'
    status?: RateLimitStatus | 'all' | 'at-risk'
    search?: string
    page?: number
    pageSize?: number
}

export interface RateLimitDashboard {
    summary: {
        windowMs: number
        limit: number
        nearLimitRatio: number
        trackedIdentifiers: number
        trackedIPs: number
        trackedApiKeys: number
        throttled: number
        nearLimit: number
        generatedAt: string
    }
    /** Throttled and near-limit identifiers, surfaced ahead of the paged list. */
    attention: {
        throttled: RateLimitConsumptionEntry[]
        nearLimit: RateLimitConsumptionEntry[]
    }
    entries: RateLimitConsumptionEntry[]
    pagination: {
        page: number
        pageSize: number
        total: number
        totalPages: number
        hasMore: boolean
    }
}

interface ConsumptionRecord {
    identifier: string
    type: RateLimitIdentifierType
    consumed: number
    throttledCount: number
    windowStartedAt: number
    lastSeenAt: number
}

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 200
/** Cap on tracked identifiers so a scattered-IP flood cannot grow the map unbounded. */
const MAX_TRACKED_IDENTIFIERS = 10_000
const ATTENTION_LIST_LIMIT = 25

class RateLimitMonitor {
    private metrics: RateLimitMetrics = {
        totalRequests: 0,
        throttledRequests: 0,
        throttledByType: {},
        throttledByEndpoint: {},
        throttledByIP: {},
        throttledByUser: {},
        lastReset: new Date()
    }

    /** Keyed by `${type}:${identifier}` — current-window consumption per IP / API key. */
    private consumption: Map<string, ConsumptionRecord> = new Map()
    /** Per-identifier limit overrides reported by callers, keyed like `consumption`. */
    private limitOverrides: Map<string, number> = new Map()

    private readonly resetInterval = 24 * 60 * 60 * 1000 // 24 hours
    private intervalId?: NodeJS.Timeout

    constructor() {
        // Only set up interval in non-test environments
        if (process.env.NODE_ENV !== 'test') {
            // Reset metrics daily
            this.intervalId = setInterval(() => {
                this.resetMetrics()
            }, this.resetInterval)
        }
    }

    /**
     * Record a rate limit violation
     */
    recordThrottle(req: Request, limitType: string): void {
        const ip = req.ip || 'unknown'
        const userAddress = req.user?.address
        const endpoint = `${req.method} ${req.route?.path || req.path}`

        this.trackConsumption(req, true)

        this.metrics.throttledRequests++
        this.metrics.throttledByType[limitType] = (this.metrics.throttledByType[limitType] || 0) + 1
        this.metrics.throttledByEndpoint[endpoint] = (this.metrics.throttledByEndpoint[endpoint] || 0) + 1
        this.metrics.throttledByIP[ip] = (this.metrics.throttledByIP[ip] || 0) + 1

        if (userAddress) {
            this.metrics.throttledByUser[userAddress] = (this.metrics.throttledByUser[userAddress] || 0) + 1
        }

        // Log detailed throttling event
        logger.warn('[RATE-LIMIT-MONITOR] Request throttled', {
            limitType,
            ip,
            userAddress,
            endpoint,
            userAgent: req.get('user-agent'),
            totalThrottled: this.metrics.throttledRequests,
            throttledByType: this.metrics.throttledByType[limitType]
        })

        // Alert on suspicious patterns
        this.checkForSuspiciousActivity(ip, userAddress, limitType)
    }

    /**
     * Record a successful request.
     * `req` is optional for backward compatibility; when supplied, the request
     * also counts toward the per-IP / per-API-key consumption dashboard.
     */
    recordRequest(req?: Request): void {
        this.metrics.totalRequests++
        if (req) this.trackConsumption(req, false)
    }

    /**
     * Record consumption for a single identifier. Exposed so callers that
     * already know the identity (e.g. background workers using an API key)
     * can report usage without an Express request.
     */
    recordConsumption(
        type: RateLimitIdentifierType,
        identifier: string,
        options: { throttled?: boolean; limit?: number } = {},
    ): void {
        if (!identifier) return

        const key = `${type}:${identifier}`
        const now = Date.now()
        let record = this.consumption.get(key)

        if (!record || now - record.windowStartedAt >= this.getWindowMs()) {
            record = {
                identifier,
                type,
                consumed: 0,
                throttledCount: 0,
                windowStartedAt: now,
                lastSeenAt: now,
            }
            this.consumption.set(key, record)
        }

        record.consumed++
        record.lastSeenAt = now
        if (options.throttled) record.throttledCount++
        if (options.limit && options.limit > 0) this.limitOverrides.set(key, options.limit)

        if (this.consumption.size > MAX_TRACKED_IDENTIFIERS) {
            this.evictStaleConsumption(now)
        }
    }

    /**
     * Combined per-IP + per-API-key rate-limit consumption view.
     * Entries are ordered most-at-risk first (throttled, then by utilization),
     * filtered and paged so the dashboard stays usable with many identifiers.
     */
    getRateLimitDashboard(query: RateLimitDashboardQuery = {}): RateLimitDashboard {
        const now = Date.now()
        const windowMs = this.getWindowMs()
        const limit = this.getLimit()
        const nearLimitRatio = this.getNearLimitRatio()

        this.pruneExpiredWindows(now)

        const all: RateLimitConsumptionEntry[] = [...this.consumption.entries()].map(([key, record]) =>
            this.toEntry(key, record, limit, windowMs, nearLimitRatio),
        )

        const typeFilter = query.type && query.type !== 'all' ? query.type : null
        const statusFilter = query.status && query.status !== 'all' ? query.status : null
        const search = query.search?.trim().toLowerCase() || null

        const filtered = all
            .filter(e => (typeFilter ? e.type === typeFilter : true))
            .filter(e => {
                if (!statusFilter) return true
                if (statusFilter === 'at-risk') return e.status !== 'ok'
                return e.status === statusFilter
            })
            .filter(e => (search ? e.identifier.toLowerCase().includes(search) : true))
            .sort(compareEntries)

        const pageSize = clampInt(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
        const page = clampInt(query.page, 1, 1, totalPages)
        const start = (page - 1) * pageSize
        const entries = filtered.slice(start, start + pageSize)

        const throttled = all.filter(e => e.status === 'throttled').sort(compareEntries)
        const nearLimit = all.filter(e => e.status === 'near-limit').sort(compareEntries)

        return {
            summary: {
                windowMs,
                limit,
                nearLimitRatio,
                trackedIdentifiers: all.length,
                trackedIPs: all.filter(e => e.type === 'ip').length,
                trackedApiKeys: all.filter(e => e.type === 'apiKey').length,
                throttled: throttled.length,
                nearLimit: nearLimit.length,
                generatedAt: new Date(now).toISOString(),
            },
            attention: {
                throttled: throttled.slice(0, ATTENTION_LIST_LIMIT),
                nearLimit: nearLimit.slice(0, ATTENTION_LIST_LIMIT),
            },
            entries,
            pagination: {
                page,
                pageSize,
                total: filtered.length,
                totalPages,
                hasMore: start + entries.length < filtered.length,
            },
        }
    }

    /** Clear all tracked consumption — used by tests and the daily reset. */
    resetConsumption(): void {
        this.consumption.clear()
        this.limitOverrides.clear()
    }

    /**
     * Get current metrics
     */
    getMetrics(): RateLimitMetrics & { throttleRate: number } {
        const throttleRate = this.metrics.totalRequests > 0 
            ? (this.metrics.throttledRequests / this.metrics.totalRequests) * 100 
            : 0

        return {
            ...this.metrics,
            throttleRate: Math.round(throttleRate * 100) / 100 // Round to 2 decimal places
        }
    }

    /**
     * Get top offenders by IP
     */
    getTopOffendersByIP(limit = 10): Array<{ ip: string; count: number }> {
        return Object.entries(this.metrics.throttledByIP)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([ip, count]) => ({ ip, count }))
    }

    /**
     * Get top offenders by user
     */
    getTopOffendersByUser(limit = 10): Array<{ userAddress: string; count: number }> {
        return Object.entries(this.metrics.throttledByUser)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([userAddress, count]) => ({ userAddress, count }))
    }

    /**
     * Get throttling by endpoint
     */
    getThrottlingByEndpoint(): Array<{ endpoint: string; count: number }> {
        return Object.entries(this.metrics.throttledByEndpoint)
            .sort(([, a], [, b]) => b - a)
            .map(([endpoint, count]) => ({ endpoint, count }))
    }

    /** Record both the IP and (when present) the API key behind a request. */
    private trackConsumption(req: Request, throttled: boolean): void {
        const ip = req.ip || 'unknown'
        this.recordConsumption('ip', ip, { throttled })

        const keyId = req.apiKeyUser?.keyId
        if (keyId) {
            this.recordConsumption('apiKey', keyId, { throttled })
        }
    }

    private toEntry(
        key: string,
        record: ConsumptionRecord,
        limit: number,
        windowMs: number,
        nearLimitRatio: number,
    ): RateLimitConsumptionEntry {
        const effectiveLimit = this.limitOverrides.get(key) ?? limit
        const utilization = effectiveLimit > 0 ? record.consumed / effectiveLimit : 0
        const status: RateLimitStatus =
            record.throttledCount > 0
                ? 'throttled'
                : utilization >= nearLimitRatio
                    ? 'near-limit'
                    : 'ok'

        return {
            identifier: record.identifier,
            type: record.type,
            consumed: record.consumed,
            limit: effectiveLimit,
            remaining: Math.max(0, effectiveLimit - record.consumed),
            utilization: Math.round(utilization * 10000) / 10000,
            throttledCount: record.throttledCount,
            status,
            windowStartedAt: new Date(record.windowStartedAt).toISOString(),
            windowResetsAt: new Date(record.windowStartedAt + windowMs).toISOString(),
            lastSeenAt: new Date(record.lastSeenAt).toISOString(),
        }
    }

    /** Drop records whose window has elapsed — they no longer reflect live consumption. */
    private pruneExpiredWindows(now: number): void {
        const windowMs = this.getWindowMs()
        for (const [key, record] of this.consumption) {
            if (now - record.windowStartedAt >= windowMs) {
                this.consumption.delete(key)
                this.limitOverrides.delete(key)
            }
        }
    }

    /** Hard cap fallback: drop the least recently seen half of the tracked set. */
    private evictStaleConsumption(now: number): void {
        this.pruneExpiredWindows(now)
        if (this.consumption.size <= MAX_TRACKED_IDENTIFIERS) return

        const byOldest = [...this.consumption.entries()].sort(
            ([, a], [, b]) => a.lastSeenAt - b.lastSeenAt,
        )
        for (let i = 0; i < Math.floor(byOldest.length / 2); i++) {
            this.consumption.delete(byOldest[i][0])
            this.limitOverrides.delete(byOldest[i][0])
        }
    }

    private getWindowMs(): number {
        return (
            parseInt(
                process.env.RATE_LIMIT_WINDOW_MS || process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || '',
                10,
            ) || 15 * 60 * 1000
        )
    }

    private getLimit(): number {
        return (
            parseInt(process.env.RATE_LIMIT_MAX || process.env.RATE_LIMIT_GLOBAL_MAX || '', 10) || 100
        )
    }

    private getNearLimitRatio(): number {
        const parsed = parseFloat(process.env.RATE_LIMIT_NEAR_LIMIT_RATIO || '')
        if (!isNaN(parsed) && parsed > 0 && parsed <= 1) return parsed
        return 0.8
    }

    /**
     * Reset all metrics
     */
    private resetMetrics(): void {
        logger.info('[RATE-LIMIT-MONITOR] Resetting daily metrics', {
            previousMetrics: this.getMetrics()
        })

        this.metrics = {
            totalRequests: 0,
            throttledRequests: 0,
            throttledByType: {},
            throttledByEndpoint: {},
            throttledByIP: {},
            throttledByUser: {},
            lastReset: new Date()
        }

        this.resetConsumption()
    }

    /**
     * Check for suspicious activity patterns
     */
    private checkForSuspiciousActivity(ip: string, userAddress: string | undefined, limitType: string): void {
        const ipThrottleCount = this.metrics.throttledByIP[ip] || 0
        const userThrottleCount = userAddress ? (this.metrics.throttledByUser[userAddress] || 0) : 0

        // Alert thresholds
        const IP_ALERT_THRESHOLD = 50
        const USER_ALERT_THRESHOLD = 25
        const CRITICAL_THRESHOLD = 100

        if (ipThrottleCount === IP_ALERT_THRESHOLD) {
            logger.warn('[RATE-LIMIT-MONITOR] Suspicious IP activity detected', {
                ip,
                throttleCount: ipThrottleCount,
                limitType,
                severity: 'medium'
            })
        }

        if (userAddress && userThrottleCount === USER_ALERT_THRESHOLD) {
            logger.warn('[RATE-LIMIT-MONITOR] Suspicious user activity detected', {
                userAddress,
                throttleCount: userThrottleCount,
                limitType,
                severity: 'medium'
            })
        }

        if (ipThrottleCount >= CRITICAL_THRESHOLD) {
            logger.error('[RATE-LIMIT-MONITOR] Critical IP abuse detected', {
                ip,
                throttleCount: ipThrottleCount,
                limitType,
                severity: 'critical',
                action: 'consider_ip_ban'
            })
        }

        if (userAddress && userThrottleCount >= CRITICAL_THRESHOLD) {
            logger.error('[RATE-LIMIT-MONITOR] Critical user abuse detected', {
                userAddress,
                throttleCount: userThrottleCount,
                limitType,
                severity: 'critical',
                action: 'consider_user_ban'
            })
        }
    }

    /**
     * Generate a summary report
     */
    generateReport(): string {
        const metrics = this.getMetrics()
        const topIPs = this.getTopOffendersByIP(5)
        const topUsers = this.getTopOffendersByUser(5)
        const topEndpoints = this.getThrottlingByEndpoint().slice(0, 5)

        return `
Rate Limiting Report (since ${metrics.lastReset.toISOString()}):
- Total Requests: ${metrics.totalRequests}
- Throttled Requests: ${metrics.throttledRequests}
- Throttle Rate: ${metrics.throttleRate}%

Top Offending IPs:
${topIPs.map(({ ip, count }) => `  ${ip}: ${count} throttles`).join('\n')}

Top Offending Users:
${topUsers.map(({ userAddress, count }) => `  ${userAddress}: ${count} throttles`).join('\n')}

Most Throttled Endpoints:
${topEndpoints.map(({ endpoint, count }) => `  ${endpoint}: ${count} throttles`).join('\n')}

Throttles by Type:
${Object.entries(metrics.throttledByType).map(([type, count]) => `  ${type}: ${count}`).join('\n')}
        `.trim()
    }
}

// ── dashboard helpers ──────────────────────────────────────────────────────────

const STATUS_RANK: Record<RateLimitStatus, number> = {
    throttled: 0,
    'near-limit': 1,
    ok: 2,
}

/** Most-at-risk first: throttled, then near-limit, then by utilization desc. */
function compareEntries(a: RateLimitConsumptionEntry, b: RateLimitConsumptionEntry): number {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (byStatus !== 0) return byStatus
    if (b.utilization !== a.utilization) return b.utilization - a.utilization
    if (b.consumed !== a.consumed) return b.consumed - a.consumed
    return a.identifier.localeCompare(b.identifier)
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
    if (isNaN(parsed)) return fallback
    return Math.min(max, Math.max(min, Math.floor(parsed)))
}

// Singleton instance
export const rateLimitMonitor = new RateLimitMonitor()