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
     * Record a successful request
     */
    recordRequest(): void {
        this.metrics.totalRequests++
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

// Singleton instance
export const rateLimitMonitor = new RateLimitMonitor()