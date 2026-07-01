import { Router, Request, Response } from 'express'
import { blockDebugInProduction } from '../middleware/debugGate.js'
import { requireAdmin } from '../middleware/auth.js'
import { validateRequest } from '../middleware/validate.js'
import { debugTestNotificationSchema } from './validation.js'
import { notificationService } from '../services/notificationService.js'
import { buildTestNotificationPayload } from '../services/notificationTemplates.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'
import { ReflectorService } from '../services/reflector.js'
import { autoRebalancer } from '../services/runtimeServices.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { redactObject } from '../utils/secretRedactor.js'

export const debugRouter = Router()

const reflectorService = new ReflectorService()

/**
 * Debug-only + admin-gated endpoint for sending a single test notification.
 * This keeps test-notification behavior explicit and isolated from production routes.
 */
debugRouter.post('/debug/notifications/test', blockDebugInProduction, requireAdmin, validateRequest(debugTestNotificationSchema), async (req: Request, res: Response) => {
    try {
        const userId = (req.body.userId ?? req.user?.address) as string | undefined
        const normalizedEventType = (req.body.eventType ?? 'rebalance') as 'rebalance' | 'circuitBreaker' | 'priceMovement' | 'riskChange'

        if (!userId) return fail(res, 400, 'VALIDATION_ERROR', 'userId is required')

        const preferences = notificationService.getPreferences(userId)
        if (!preferences) {
            return fail(res, 404, 'NOT_FOUND', 'No notification preferences found for this user')
        }

        await notificationService.notify(buildTestNotificationPayload(userId, normalizedEventType))

        logger.info('Debug test notification sent', { userId, eventType: normalizedEventType })
        const response = {
            message: 'Test notification sent successfully',
            eventType: normalizedEventType,
            sentTo: {
                email: preferences.emailEnabled ? preferences.emailAddress : null,
                webhook: preferences.webhookEnabled ? preferences.webhookUrl : null
            }
        }
        return ok(res, redactObject(response))
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

        const fetchResponse = await fetch(testUrl, { headers })
        const data = await fetchResponse.json()

        const response = {
            apiKeySet: !!apiKey,
            testUrl,
            responseStatus: fetchResponse.status,
            responseData: data
        }
        return ok(res, redactObject(response))
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

        const { prices, feedMeta } = await reflectorService.getCurrentPricesWithMeta()

        const response = {
            cacheCleared: true,
            cacheStatusAfterClear: cacheStatus,
            freshPrices: prices,
            feedMeta
        }
        return ok(res, redactObject(response))
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

debugRouter.get('/debug/reflector-test', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        logger.info('[DEBUG] Testing reflector service...')

        const testResult = await reflectorService.testApiConnectivity()
        const cacheStatus = reflectorService.getCacheStatus()

        const response = {
            apiConnectivityTest: testResult,
            cacheStatus,
            environment: {
                nodeEnv: global.process.env.NODE_ENV,
                apiKeySet: !!global.process.env.COINGECKO_API_KEY,
            }
        }
        return ok(res, redactObject(response))
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

debugRouter.get('/debug/env', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        const response = {
            environment: global.process.env.NODE_ENV,
            apiKeySet: !!global.process.env.COINGECKO_API_KEY,
            autoRebalancerEnabled: !!autoRebalancer,
            autoRebalancerRunning: autoRebalancer ? autoRebalancer.getStatus().isRunning : false,
            enableAutoRebalancer: global.process.env.ENABLE_AUTO_REBALANCER,
            port: global.process.env.PORT
        }
        return ok(res, redactObject(response))
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

        const response = {
            autoRebalancerAvailable: true,
            status,
            statistics,
            portfolioCount,
            testTimestamp: new Date().toISOString()
        }
        return ok(res, redactObject(response))
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error), {
            autoRebalancerAvailable: false
        })
    }
})
