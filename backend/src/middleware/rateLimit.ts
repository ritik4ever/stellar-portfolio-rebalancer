import { rateLimit, type Options } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import IORedis from 'ioredis'
import { fail } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'
import { rateLimitMonitor } from '../services/rateLimitMonitor.js'
import { REDIS_URL } from '../queue/connection.js'

// Rate limiting configuration from environment
const GLOBAL_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000
const GLOBAL_MAX = Number(process.env.RATE_LIMIT_MAX) || 100
const WRITE_MAX = Number(process.env.RATE_LIMIT_WRITE_MAX) || 10
const AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX) || 5
const CRITICAL_MAX = Number(process.env.RATE_LIMIT_CRITICAL_MAX) || 3

// Burst protection - shorter windows with lower limits
const BURST_WINDOW_MS = Number(process.env.RATE_LIMIT_BURST_WINDOW_MS) || 10 * 1000
const BURST_MAX = Number(process.env.RATE_LIMIT_BURST_MAX) || 20
const WRITE_BURST_MAX = Number(process.env.RATE_LIMIT_WRITE_BURST_MAX) || 3

// Redis store for shared rate limiting across instances
let redisStore: RedisStore | undefined
let redisClient: IORedis | undefined

try {
    redisClient = new IORedis(REDIS_URL, {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
    })
    
    redisStore = new RedisStore({
        sendCommand: (...args: Parameters<IORedis['call']>) => redisClient!.call(...args) as Promise<any>,
    })
    
    logger.info('[RATE-LIMIT] Redis store initialized for distributed rate limiting', {
        redisUrl: REDIS_URL.replace(/:\/\/[^@]*@/, '://***@')
    })
} catch (error) {
    logger.warn('[RATE-LIMIT] Redis unavailable - falling back to memory store (single instance only)', {
        error: error instanceof Error ? error.message : String(error)
    })
}

// Enhanced rate limit handler with detailed metrics
function createHandler(windowMs: number, limitType: string) {
    const retryAfterSec = Math.ceil(windowMs / 1000)
    return (req: import('express').Request, res: import('express').Response) => {
        const ip = req.ip
        const userAddress = req.user?.address
        const endpoint = `${req.method} ${req.route?.path || req.path}`
        
        // Record the throttling event
        rateLimitMonitor.recordThrottle(req, limitType)
        
        // Log rate limit violation for monitoring
        logger.warn('[RATE-LIMIT] Request throttled', {
            limitType,
            ip,
            userAddress,
            endpoint,
            userAgent: req.get('user-agent'),
            retryAfter: retryAfterSec
        })
        
        res.setHeader('Retry-After', String(retryAfterSec))
        res.setHeader('X-RateLimit-Limit-Type', limitType)
        
        fail(
            res,
            429,
            'RATE_LIMITED',
            `Rate limit exceeded for ${limitType}. Please try again later.`,
            {
                limitType,
                retryAfter: retryAfterSec,
                endpoint
            },
            { 
                meta: { 
                    retryAfter: retryAfterSec,
                    limitType,
                    endpoint
                } 
            }
        )
    }
}

// Key generator that combines IP and wallet address for authenticated requests
function createKeyGenerator(prefix: string) {
    return (req: import('express').Request): string => {
        const ip = req.ip || 'unknown'
        const userAddress = req.user?.address
        
        // For authenticated requests, use both IP and wallet address
        if (userAddress) {
            return `${prefix}:${ip}:${userAddress}`
        }
        
        // For unauthenticated requests, use IP only
        return `${prefix}:${ip}`
    }
}

// Skip rate limiting for health checks and internal requests
function skipSuccessfulRequests(req: import('express').Request, res: import('express').Response): boolean {
    // Skip health checks
    if (req.path === '/health' || req.path === '/metrics') {
        return true
    }
    
    // Skip successful responses (only count failed/suspicious requests)
    return res.statusCode < 400
}

// Base options for all rate limiters
const baseOptions: Partial<Options> = {
    standardHeaders: 'draft-7', // Use latest standard headers
    legacyHeaders: false,
    store: redisStore, // Will fall back to memory store if Redis unavailable
    skip: skipSuccessfulRequests,
}

// Global rate limiter - applies to all requests
export const globalRateLimiter = rateLimit({
    ...baseOptions,
    windowMs: GLOBAL_WINDOW_MS,
    limit: GLOBAL_MAX,
    keyGenerator: createKeyGenerator('global'),
    handler: createHandler(GLOBAL_WINDOW_MS, 'global'),
    message: 'Too many requests from this IP, please try again later.'
})

// Burst protection - very short window to prevent rapid-fire attacks
export const burstProtectionLimiter = rateLimit({
    ...baseOptions,
    windowMs: BURST_WINDOW_MS,
    limit: BURST_MAX,
    keyGenerator: createKeyGenerator('burst'),
    handler: createHandler(BURST_WINDOW_MS, 'burst-protection'),
    skip: (req) => req.path === '/health' || req.path === '/metrics', // Only skip health checks
})

// Write operations rate limiter - stricter limits for mutating operations
export const writeRateLimiter = rateLimit({
    ...baseOptions,
    windowMs: GLOBAL_WINDOW_MS,
    limit: WRITE_MAX,
    keyGenerator: createKeyGenerator('write'),
    handler: createHandler(GLOBAL_WINDOW_MS, 'write-operations'),
})

// Write burst protection - prevent rapid write attempts
export const writeBurstLimiter = rateLimit({
    ...baseOptions,
    windowMs: BURST_WINDOW_MS,
    limit: WRITE_BURST_MAX,
    keyGenerator: createKeyGenerator('write-burst'),
    handler: createHandler(BURST_WINDOW_MS, 'write-burst-protection'),
})

// Authentication rate limiter - protect login/refresh endpoints
export const authRateLimiter = rateLimit({
    ...baseOptions,
    windowMs: GLOBAL_WINDOW_MS,
    limit: AUTH_MAX,
    keyGenerator: createKeyGenerator('auth'),
    handler: createHandler(GLOBAL_WINDOW_MS, 'authentication'),
    skip: () => false, // Never skip auth rate limiting
})

// Critical operations rate limiter - for rebalancing and high-value operations
export const criticalRateLimiter = rateLimit({
    ...baseOptions,
    windowMs: GLOBAL_WINDOW_MS,
    limit: CRITICAL_MAX,
    keyGenerator: createKeyGenerator('critical'),
    handler: createHandler(GLOBAL_WINDOW_MS, 'critical-operations'),
    skip: () => false, // Never skip critical operation rate limiting
})

// Admin operations rate limiter - protect admin endpoints
export const adminRateLimiter = rateLimit({
    ...baseOptions,
    windowMs: GLOBAL_WINDOW_MS,
    limit: AUTH_MAX, // Same as auth for admin operations
    keyGenerator: createKeyGenerator('admin'),
    handler: createHandler(GLOBAL_WINDOW_MS, 'admin-operations'),
    skip: () => false,
})

// Composite middleware for write operations (combines write + burst protection)
export const protectedWriteLimiter = [writeBurstLimiter, writeRateLimiter]

// Composite middleware for critical operations (combines critical + burst protection)
export const protectedCriticalLimiter = [burstProtectionLimiter, criticalRateLimiter]

// Middleware to record successful requests for monitoring
export const requestMonitoringMiddleware = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void => {
    rateLimitMonitor.recordRequest()
    next()
}

// Graceful shutdown function
export async function closeRateLimitStore(): Promise<void> {
    if (redisClient) {
        try {
            await redisClient.quit()
            logger.info('[RATE-LIMIT] Redis connection closed')
        } catch (error) {
            logger.warn('[RATE-LIMIT] Error closing Redis connection', {
                error: error instanceof Error ? error.message : String(error)
            })
        }
    }
}
