import { Router, Request, Response } from 'express'
import { blockDebugInProduction } from '../middleware/debugGate.js'
import { requireAdmin } from '../middleware/auth.js'
import { adminRateLimiter } from '../middleware/rateLimit.js'
import { validateRequest } from '../middleware/validate.js'
import { debugTestNotificationSchema } from './validation.js'
import { notificationService } from '../services/notificationService.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'
import { ReflectorService } from '../services/reflector.js'
import { autoRebalancer } from '../services/runtimeServices.js'
import { portfolioStorage } from '../services/portfolioStorage.js'

export const debugRouter = Router()

const reflectorService = new ReflectorService()

/**
 * Debug-only + admin-gated endpoint for sending a single test notification.
 * This keeps test-notification behavior explicit and isolated from production routes.
 */
debugRouter.post('/debug/notifications/test', blockDebugInProduction, requireAdmin, adminRateLimiter, validateRequest(debugTestNotificationSchema), async (req: Request, res: Response) => {
    try {
        const userId = (req.body.userId ?? req.user?.address) as string | undefined
        const normalizedEventType = (req.body.eventType ?? 'rebalance') as 'rebalance' | 'circuitBreaker' | 'priceMovement' | 'riskChange'

        if (!userId) return fail(res, 400, 'VALIDATION_ERROR', 'userId is required')

        const preferences = notificationService.getPreferences(userId)
        if (!preferences) {
            return fail(res, 404, 'NOT_FOUND', 'No notification preferences found for this user')
        }

        const payloadBase = {
            userId,
            eventType: normalizedEventType,
            timestamp: new Date().toISOString()
        }

        const payloadByType = {
            rebalance: {
                title: 'Test: Portfolio Rebalanced',
                message: 'Test rebalance notification - 3 trades executed.',
                data: { portfolioId: 'test-portfolio-123', trades: 3, gasUsed: '0.0234 XLM' }
            },
            circuitBreaker: {
                title: 'Test: Circuit Breaker Triggered',
                message: 'Test circuit breaker notification - BTC moved 22.5%.',
                data: { asset: 'BTC', priceChange: '22.5', cooldownMinutes: 5 }
            },
            priceMovement: {
                title: 'Test: Large Price Movement',
                message: 'Test price movement notification - ETH up 12.34%.',
                data: { asset: 'ETH', priceChange: '12.34', direction: 'increased' }
            },
            riskChange: {
                title: 'Test: Risk Level Changed',
                message: 'Test risk change notification - Risk increased to high.',
                data: { portfolioId: 'test-portfolio-123', oldLevel: 'medium', newLevel: 'high' }
            }
        } as const

        await notificationService.notify({
            ...payloadBase,
            ...payloadByType[normalizedEventType]
        })

        logger.info('Debug test notification sent', { userId, eventType: normalizedEventType })
        return ok(res, {
            message: 'Test notification sent successfully',
            eventType: normalizedEventType,
            sentTo: {
                email: preferences.emailEnabled ? preferences.emailAddress : null,
                webhook: preferences.webhookEnabled ? preferences.webhookUrl : null
            }
        })
    } catch (error) {
        logger.error('Failed to send debug test notification', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

debugRouter.get('/debug/coingecko-test', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        const apiKey = process.env.COINGECKO_API_KEY

        // Test direct API call
        const testUrl = apiKey ?
            'https://pro-api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd' :
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'

        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'User-Agent': 'StellarPortfolioRebalancer/1.0'
        }

        if (apiKey) {
            headers['x-cg-pro-api-key'] = apiKey
        }

        logger.info('[DEBUG] Test URL', { testUrl })

        const response = await fetch(testUrl, { headers })
        const data = await response.json()

        return ok(res, {
            apiKeySet: !!apiKey,
            testUrl,
            responseStatus: response.status,
            responseData: data
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error), {
            stack: error instanceof Error ? error.stack : String(error)
        })
    }
})

debugRouter.get('/debug/force-fresh-prices', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        logger.info('[DEBUG] Clearing cache and forcing fresh prices...')

        // Clear cache first
        reflectorService.clearCache()

        // Get cache status
        const cacheStatus = reflectorService.getCacheStatus()

        // Force a fresh API call
        const result = await reflectorService.getCurrentPrices()

        return ok(res, {
            cacheCleared: true,
            cacheStatusAfterClear: cacheStatus,
            freshPrices: result
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

debugRouter.get('/debug/reflector-test', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        logger.info('[DEBUG] Testing reflector service...')

        const testResult = await reflectorService.testApiConnectivity()
        const cacheStatus = reflectorService.getCacheStatus()

        return ok(res, {
            apiConnectivityTest: testResult,
            cacheStatus,
            environment: {
                nodeEnv: global.process.env.NODE_ENV,
                apiKeySet: !!global.process.env.COINGECKO_API_KEY,
                apiKeyLength: global.process.env.COINGECKO_API_KEY?.length || 0
            }
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

debugRouter.get('/debug/env', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        return ok(res, {
            environment: global.process.env.NODE_ENV,
            apiKeySet: !!global.process.env.COINGECKO_API_KEY,
            autoRebalancerEnabled: !!autoRebalancer,
            autoRebalancerRunning: autoRebalancer ? autoRebalancer.getStatus().isRunning : false,
            enableAutoRebalancer: global.process.env.ENABLE_AUTO_REBALANCER,
            port: global.process.env.PORT
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

debugRouter.get('/debug/auto-rebalancer-test', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return fail(res, 500, 'INTERNAL_ERROR', 'Auto-rebalancer not initialized', {
                autoRebalancerAvailable: false
            })
        }

        const status = autoRebalancer.getStatus()
        const statistics = await autoRebalancer.getStatistics()
        const portfolioCount = await portfolioStorage.getPortfolioCount()

        return ok(res, {
            autoRebalancerAvailable: true,
            status,
            statistics,
            portfolioCount,
            testTimestamp: new Date().toISOString()
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error), {
            autoRebalancerAvailable: false
        })
    }
})
