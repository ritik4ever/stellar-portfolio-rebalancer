import { Router, Request, Response } from 'express'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { riskManagementService, rebalanceHistoryService } from '../services/serviceContainer.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { CircuitBreakers } from '../services/circuitBreakers.js'
import { analyticsService } from '../services/analyticsService.js'
import { notificationService } from '../services/notificationService.js'
import { contractEventIndexerService } from '../services/contractEventIndexer.js'
import { AutoRebalancerService } from '../services/autoRebalancer.js'
import { logger } from '../utils/logger.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { requireAdmin } from '../middleware/auth.js'
import { writeRateLimiter } from '../middleware/rateLimit.js'
import { blockDebugInProduction } from '../middleware/debugGate.js'
import { getFeatureFlags, getPublicFeatureFlags } from '../config/featureFlags.js'
import { getQueueMetrics } from '../queue/queueMetrics.js'
import { getErrorMessage, getErrorObject, parseOptionalBoolean } from '../utils/helpers.js'

const router = Router()
const stellarService = new StellarService()
const reflectorService = new ReflectorService()
const autoRebalancer = new AutoRebalancerService()
const featureFlags = getFeatureFlags()
const publicFeatureFlags = getPublicFeatureFlags()

const parseOptionalTimestamp = (value: unknown): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') return undefined
    const ts = new Date(value)
    if (Number.isNaN(ts.getTime())) return undefined
    return ts.toISOString()
}

const parseHistorySource = (value: unknown): 'offchain' | 'simulated' | 'onchain' | undefined => {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().toLowerCase()
    if (normalized === 'offchain') return 'offchain'
    if (normalized === 'simulated') return 'simulated'
    if (normalized === 'onchain') return 'onchain'
    return undefined
}


router.get('/rebalance/history', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.query.portfolioId as string
        const limit = parseInt(req.query.limit as string) || 50
        const source = parseHistorySource(req.query.source)
        const startTimestamp = parseOptionalTimestamp(req.query.startTimestamp)
        const endTimestamp = parseOptionalTimestamp(req.query.endTimestamp)
        const syncOnChain = parseOptionalBoolean(req.query.syncOnChain) === true

        logger.info('Rebalance history request', { portfolioId: portfolioId || 'all' })
        if (syncOnChain) {
            await contractEventIndexerService.syncOnce()
        }

        const history = await rebalanceHistoryService.getRebalanceHistory(
            portfolioId || undefined,
            limit,
            {
                eventSource: source === 'all' ? undefined : source,
                startTimestamp,
                endTimestamp
            }
        )

        return res.json({
            success: true,
            history,
            count: history.length,
            portfolioId: portfolioId || undefined,
            filters: {
                source,
                startTimestamp,
                endTimestamp
            }
        })

    } catch (error) {
        logger.error('[ERROR] Rebalance history failed', { error: getErrorObject(error) })
        res.json({
            success: false,
            error: getErrorMessage(error),
            history: []
        })
    }
})

// Record new rebalance event
router.post('/rebalance/history', idempotencyMiddleware, async (req: Request, res: Response) => {
    try {
        const eventData = req.body

        logger.info('Recording new rebalance event', { eventData })

        const event = await rebalanceHistoryService.recordRebalanceEvent({
            ...eventData,
            isAutomatic: eventData.isAutomatic || false
        })

        res.json({
            success: true,
            event,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('[ERROR] Failed to record rebalance event', { error: getErrorObject(error) })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

router.post('/rebalance/history/sync-onchain', requireAdmin, async (req: Request, res: Response) => {
    try {
        const result = await contractEventIndexerService.syncOnce()
        res.json({
            success: true,
            ...result,
            indexer: contractEventIndexerService.getStatus(),
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

// Manual portfolio rebalance
router.post('/portfolio/:id/rebalance', writeRateLimiter, idempotencyMiddleware, async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id;

        console.log(`[INFO] Attempting manual rebalance for portfolio: ${portfolioId}`);

        // Try to acquire lock
        const lockAcquired = await rebalanceLockService.acquireLock(portfolioId);
        if (!lockAcquired) {
            console.log(`[WARNING] Rebalance already in progress for portfolio: ${portfolioId}`);
            return res.status(409).json({
                success: false,
                error: 'Rebalance already in progress for this portfolio'
            });
        }

        try {
            const portfolio = await stellarService.getPortfolio(portfolioId);
            const prices = await reflectorService.getCurrentPrices();
            const riskCheck = riskManagementService.shouldAllowRebalance(portfolio as unknown as Portfolio, prices);

            if (!riskCheck.allowed) {
                return res.status(400).json({
                    success: false,
                    error: riskCheck.reason,
                    alerts: riskCheck.alerts
                });
            }

            const result = await stellarService.executeRebalance(portfolioId);

            res.json({
                success: true,
                result,
                timestamp: new Date().toISOString()
            });
        } finally {
            await rebalanceLockService.releaseLock(portfolioId);
        }
    } catch (error) {
        console.error('[ERROR] Manual rebalance failed:', error);
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        });
    }
});

// ================================
// RISK MANAGEMENT ROUTES
// ================================

// Get risk metrics for a portfolio
router.get('/risk/metrics/:portfolioId', async (req: Request, res: Response) => {
    try {
        const { portfolioId } = req.params

        logger.info('Calculating risk metrics for portfolio', { portfolioId })

        const portfolio = await stellarService.getPortfolio(portfolioId)
        const prices = await reflectorService.getCurrentPrices()

        // Calculate risk metrics with proper type conversion
        const allocationsRecord: Record<string, number> = {}
        if (Array.isArray(portfolio.allocations)) {
            portfolio.allocations.forEach((a: any) => {
                allocationsRecord[a.asset] = a.target
            })
        } else {
            Object.assign(allocationsRecord, portfolio.allocations)
        }
        const riskMetrics = riskManagementService.analyzePortfolioRisk(allocationsRecord, prices)
        const recommendations = riskManagementService.getRecommendations(riskMetrics, allocationsRecord)
        const circuitBreakers = riskManagementService.getCircuitBreakerStatus()

        res.json({
            success: true,
            portfolioId,
            riskMetrics,
            recommendations,
            circuitBreakers,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('[ERROR] Failed to get risk metrics', { error: getErrorObject(error) })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            riskMetrics: {
                volatility: 0,
                concentrationRisk: 0,
                liquidityRisk: 0,
                correlationRisk: 0,

            }
        })
    }
})

// Check if rebalancing should be allowed based on risk conditions
router.get('/risk/check/:portfolioId', async (req: Request, res: Response) => {
    try {
        const { portfolioId } = req.params

        logger.info('Checking risk conditions for portfolio', { portfolioId })

        const portfolio = await stellarService.getPortfolio(portfolioId)
        const prices = await reflectorService.getCurrentPrices()

        const riskCheck = riskManagementService.shouldAllowRebalance(portfolio as unknown as Portfolio, prices)

        res.json({
            success: true,
            portfolioId,
            ...riskCheck,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('[ERROR] Failed to check risk conditions', { error: getErrorObject(error) })
        res.status(500).json({
            success: false,
            allowed: false,
            reason: 'Failed to assess risk conditions',
            alerts: [],
            error: getErrorMessage(error)
        })
    }
})

// ================================
// PRICE DATA ROUTES - FIXED FORMAT
// ================================

// Get current prices - FIXED to return direct format for frontend
router.get('/prices', async (req: Request, res: Response) => {
    try {
        logger.info('[DEBUG] Fetching prices for frontend...')
        const prices = await reflectorService.getCurrentPrices()

        logger.info('[DEBUG] Raw prices from service', { prices })

        // Return prices directly in the format frontend expects
        res.json(prices)

    } catch (error) {
        logger.error('[ERROR] Prices endpoint failed', { error: getErrorObject(error) })

        if (!featureFlags.allowFallbackPrices) {
            return res.status(503).json({
                success: false,
                error: 'Price feeds unavailable and ALLOW_FALLBACK_PRICES is disabled'
            })
        }

        // Return explicit fallback data only when feature flag allows it.
        const fallbackPrices = {
            XLM: { price: 0.358878, change: -0.60, timestamp: Date.now() / 1000, source: 'fallback' },
            BTC: { price: 111150, change: 0.23, timestamp: Date.now() / 1000, source: 'fallback' },
            ETH: { price: 4384.56, change: -0.15, timestamp: Date.now() / 1000, source: 'fallback' },
            USDC: { price: 0.999781, change: -0.002, timestamp: Date.now() / 1000, source: 'fallback' }
        }

        logger.info('[DEBUG] Sending fallback prices', { fallbackPrices })
        res.json(fallbackPrices)
    }
})

// Enhanced prices endpoint with risk analysis
router.get('/prices/enhanced', async (req: Request, res: Response) => {
    try {
        logger.info('[INFO] Fetching enhanced prices with risk analysis')

        const prices = await reflectorService.getCurrentPrices()

        // Update risk management with latest prices and get alerts
        const riskAlerts = riskManagementService.updatePriceData(prices)

        // Add risk information to price data
        const enhancedPrices: Record<string, any> = {}

        Object.entries(prices).forEach(([asset, data]) => {
            // Type assertion to handle PriceData properly
            const priceData = data as any

            enhancedPrices[asset] = {
                ...priceData,
                riskAlerts: riskAlerts.filter((alert: any) => alert.asset === asset),
                volatilityLevel: Math.abs(priceData.change || 0) > 10 ? 'high' :
                    Math.abs(priceData.change || 0) > 5 ? 'medium' : 'low'
            }
        })

        res.json({
            success: true,
            prices: enhancedPrices,
            riskAlerts,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('[ERROR] Failed to fetch enhanced prices', { error: getErrorObject(error) })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            prices: {},
            riskAlerts: [],
            circuitBreakers: {}
        })
    }
})

// Get detailed market data for specific asset
router.get('/market/:asset/details', async (req: Request, res: Response) => {
    try {
        const asset = req.params.asset.toUpperCase()
        const reflector = new ReflectorService()
        const marketData = await reflector.getDetailedMarketData(asset)

        res.json({
            ...marketData,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('Failed to fetch detailed market data', { error: getErrorObject(error) })
        res.status(500).json({ error: 'Failed to fetch market data' })
    }
})

// Get price charts for frontend
router.get('/market/:asset/chart', async (req: Request, res: Response) => {
    try {
        const asset = req.params.asset.toUpperCase()
        const days = parseInt(req.query.days as string) || 7

        const reflector = new ReflectorService()
        const history = await reflector.getPriceHistory(asset, days)

        res.json({
            asset,
            data: history,
            timeframe: `${days}d`,
            dataPoints: history.length
        })
    } catch (error) {
        logger.error('Failed to fetch price chart', { error: getErrorObject(error) })
        res.status(500).json({ error: 'Failed to fetch chart data' })
    }
})

// ================================
// AUTO-REBALANCER ROUTES
// ================================

router.get('/auto-rebalancer/status', async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return res.json({
                success: false,
                error: 'Auto-rebalancer not initialized',
                status: { isRunning: false }
            })
        }

        const status = autoRebalancer.getStatus()
        const statistics = await autoRebalancer.getStatistics()

        res.json({
            success: true,
            status,
            statistics,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

router.post('/auto-rebalancer/start', requireAdmin, (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return res.status(500).json({
                success: false,
                error: 'Auto-rebalancer not initialized'
            })
        }

        autoRebalancer.start()

        res.json({
            success: true,
            message: 'Auto-rebalancer started successfully',
            status: autoRebalancer.getStatus(),
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

router.post('/auto-rebalancer/stop', requireAdmin, (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return res.status(500).json({
                success: false,
                error: 'Auto-rebalancer not initialized'
            })
        }

        autoRebalancer.stop()

        res.json({
            success: true,
            message: 'Auto-rebalancer stopped successfully',
            status: autoRebalancer.getStatus(),
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

router.post('/auto-rebalancer/force-check', requireAdmin, async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return res.status(500).json({
                success: false,
                error: 'Auto-rebalancer not initialized'
            })
        }

        await autoRebalancer.forceCheck()

        res.json({
            success: true,
            message: 'Force check completed',
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

router.get('/auto-rebalancer/history', requireAdmin, async (req: Request, res: Response) => {
    try {
        const portfolioId = req.query.portfolioId as string
        const limit = parseInt(req.query.limit as string) || 50

        let history
        if (portfolioId) {
            history = await rebalanceHistoryService.getRecentAutoRebalances(portfolioId, limit)
        } else {
            history = (await rebalanceHistoryService.getAllAutoRebalances(limit)).slice(0, limit)
        }

        res.json({
            success: true,
            history,
            count: history.length,
            portfolioId: portfolioId || 'all',
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            history: []
        })
    }
})

// ================================
// SYSTEM STATUS ROUTES
// ================================

// Get comprehensive system status
router.get('/system/status', async (req: Request, res: Response) => {
    try {
        const portfolioCount = await portfolioStorage.getPortfolioCount()
        const historyStats = await rebalanceHistoryService.getHistoryStats()
        const circuitBreakers = riskManagementService.getCircuitBreakerStatus()

        // Check API health
        let priceSourcesHealthy = false
        try {
            const prices = await reflectorService.getCurrentPrices()
            priceSourcesHealthy = Object.keys(prices).length > 0
        } catch {
            priceSourcesHealthy = false
        }

        // Auto-rebalancer status
        const autoRebalancerStatus = autoRebalancer ? autoRebalancer.getStatus() : { isRunning: false }
        const autoRebalancerStats = autoRebalancer ? await autoRebalancer.getStatistics() : null
        const onChainIndexerStatus = contractEventIndexerService.getStatus()

        res.json({
            success: true,
            system: {
                status: priceSourcesHealthy ? 'operational' : 'degraded',
                uptime: global.process.uptime(),
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            },
            portfolios: {
                total: portfolioCount,
                active: portfolioCount
            },
            rebalanceHistory: historyStats,
            riskManagement: {
                circuitBreakers,
                enabled: true,
                alertsActive: Object.values(circuitBreakers).some((cb: any) => cb.isTriggered)
            },
            autoRebalancer: {
                status: autoRebalancerStatus,
                statistics: autoRebalancerStats,
                enabled: !!autoRebalancer
            },
            onChainIndexer: onChainIndexerStatus,
            services: {
                priceFeeds: priceSourcesHealthy,
                riskManagement: true,
                webSockets: true,
                autoRebalancing: autoRebalancerStatus.isRunning,
                stellarNetwork: true,
                contractEventIndexer: onChainIndexerStatus.enabled
            },
            featureFlags: publicFeatureFlags
        })
    } catch (error) {
        logger.error('[ERROR] Failed to get system status', { error: getErrorObject(error) })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            system: { status: 'error' }
        })
    }
})

// ================================
// ANALYTICS ROUTES
// ================================

router.get('/portfolio/:id/analytics', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        const days = parseInt(req.query.days as string) || 30

        if (!portfolioId) {
            return res.status(400).json({ error: 'Portfolio ID required' })
        }

        const portfolio = portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return res.status(404).json({ error: 'Portfolio not found' })
        }

        const analytics = analyticsService.getAnalytics(portfolioId, days)

        res.json({
            success: true,
            portfolioId,
            data: analytics,
            count: analytics.length,
            period: `${days} days`,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('Failed to fetch analytics', { error: getErrorObject(error), portfolioId: req.params.id })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

router.get('/portfolio/:id/performance-summary', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id

        if (!portfolioId) {
            return res.status(400).json({ error: 'Portfolio ID required' })
        }

        const portfolio = portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return res.status(404).json({ error: 'Portfolio not found' })
        }

        const summary = analyticsService.getPerformanceSummary(portfolioId)

        res.json({
            success: true,
            portfolioId,
            ...summary,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('Failed to fetch performance summary', { error: getErrorObject(error), portfolioId: req.params.id })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

// ================================
// NOTIFICATION ROUTES
// ================================

// Subscribe to notifications
router.post('/notifications/subscribe', writeRateLimiter, idempotencyMiddleware, async (req: Request, res: Response) => {
    try {
        const { userId, emailEnabled, emailAddress, webhookEnabled, webhookUrl, events } = req.body

        // Validation
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required'
            })
        }

        if (emailEnabled === undefined || webhookEnabled === undefined || !events) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: emailEnabled, webhookEnabled, events'
            })
        }

        // Validate events object
        const requiredEvents = ['rebalance', 'circuitBreaker', 'priceMovement', 'riskChange']
        for (const event of requiredEvents) {
            if (events[event] === undefined) {
                return res.status(400).json({
                    success: false,
                    error: `Missing event configuration: ${event}`
                })
            }
        }

        // Validate email address if email is enabled
        if (emailEnabled && !emailAddress) {
            return res.status(400).json({
                success: false,
                error: 'email address is required when emailEnabled is true'
            })
        }

        // Validate webhook URL if webhook is enabled
        if (webhookEnabled && !webhookUrl) {
            return res.status(400).json({
                success: false,
                error: 'webhookUrl is required when webhookEnabled is true'
            })
        }

        if (webhookUrl && !webhookUrl.match(/^https?:\/\/.+/)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid webhook URL format. Must start with http:// or https://'
            })
        }

        // Subscribe user
        notificationService.subscribe({
            userId,
            emailEnabled,
            emailAddress,
            webhookEnabled,
            webhookUrl,
            events
        })

        logger.info('User subscribed to notifications', { userId, emailEnabled, webhookEnabled })

        res.json({
            success: true,
            message: 'Notification preferences saved successfully',
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('Failed to subscribe to notifications', { error: getErrorObject(error) })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

// Get notification preferences
router.get('/notifications/preferences', async (req: Request, res: Response) => {
    try {
        const userId = req.query.userId as string

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId query parameter is required'
            })
        }

        const preferences = notificationService.getPreferences(userId)

        if (!preferences) {
            return res.json({
                success: true,
                preferences: null,
                message: 'No preferences found for this user'
            })
        }

        res.json({
            success: true,
            preferences,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('Failed to get notification preferences', { error: getErrorObject(error) })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

// Unsubscribe from notifications
router.delete('/notifications/unsubscribe', async (req: Request, res: Response) => {
    try {
        const userId = req.query.userId as string

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId query parameter is required'
            })
        }

        notificationService.unsubscribe(userId)

        logger.info('User unsubscribed from notifications', { userId })

        res.json({
            success: true,
            message: 'Successfully unsubscribed from all notifications',
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('Failed to unsubscribe from notifications', { error: getErrorObject(error) })
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

// ================================
// NOTIFICATION TEST ROUTES
// ================================

// Test notification delivery
// router.post('/notifications/test', async (req: Request, res: Response) => {
//     try {
//         const { userId, eventType } = req.body

//         if (!userId) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'userId is required'
//             })
//         }

//         if (!eventType || !['rebalance', 'circuitBreaker', 'priceMovement', 'riskChange'].includes(eventType)) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'eventType must be one of: rebalance, circuitBreaker, priceMovement, riskChange'
//             })
//         }

//         // Check if user has preferences
//         const preferences = notificationService.getPreferences(userId)
//         if (!preferences) {
//             return res.status(404).json({
//                 success: false,
//                 error: 'No notification preferences found for this user. Please subscribe first.'
//             })
//         }

//         // Create test notification payload based on event type
//         let payload: any = {
//             userId,
//             eventType,
//             timestamp: new Date().toISOString()
//         }

//         switch (eventType) {
//             case 'rebalance':
//                 payload.title = 'Test: Portfolio Rebalanced'
//                 payload.message = 'This is a test notification for a rebalance event. Your portfolio has been rebalanced with 3 trades executed.'
//                 payload.data = {
//                     portfolioId: 'test-portfolio-123',
//                     trades: 3,
//                     gasUsed: '0.0234 XLM',
//                     trigger: 'manual'
//                 }
//                 break

//             case 'circuitBreaker':
//                 payload.title = 'Test: Circuit Breaker Triggered'
//                 payload.message = 'This is a test notification for a circuit breaker event. Circuit breaker activated for BTC due to 22.5% price movement.'
//                 payload.data = {
//                     asset: 'BTC',
//                     priceChange: '22.5',
//                     cooldownMinutes: 5
//                 }
//                 break

//             case 'priceMovement':
//                 payload.title = 'Test: Large Price Movement Detected'
//                 payload.message = 'This is a test notification for a price movement event. ETH price increased by 12.34% to $2,150.00'
//                 payload.data = {
//                     asset: 'ETH',
//                     priceChange: '12.34',
//                     currentPrice: 2150.00,
//                     direction: 'increased'
//                 }
//                 break

//             case 'riskChange':
//                 payload.title = 'Test: Portfolio Risk Level Changed'
//                 payload.message = 'This is a test notification for a risk level change. Your portfolio risk level has increased from medium to high.'
//                 payload.data = {
//                     portfolioId: 'test-portfolio-123',
//                     oldLevel: 'medium',
//                     newLevel: 'high',
//                     severity: 'increased'
//                 }
//                 break
//         }

//         // Send the notification
//         await notificationService.notify(payload)

//         logger.info('Test notification sent', { userId, eventType })

//         res.json({
//             success: true,
//             message: 'Test notification sent successfully',
//             sentTo: {
//                 email: preferences.emailEnabled ? preferences.emailAddress : null,
//                 webhook: preferences.webhookEnabled ? preferences.webhookUrl : null
//             },
//             eventType,
//             timestamp: new Date().toISOString()
//         })
//     } catch (error) {
//         logger.error('Failed to send test notification', { error: getErrorObject(error) })
//         res.status(500).json({
//             success: false,
//             error: getErrorMessage(error)
//         })
//     }
// })

// Test all notification types at once
// router.post('/notifications/test-all', async (req: Request, res: Response) => {
//     try {
//         const { userId } = req.body

//         if (!userId) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'userId is required'
//             })
//         }

//         const preferences = notificationService.getPreferences(userId)
//         if (!preferences) {
//             return res.status(404).json({
//                 success: false,
//                 error: 'No notification preferences found for this user. Please subscribe first.'
//             })
//         }

//         const eventTypes = ['rebalance', 'circuitBreaker', 'priceMovement', 'riskChange']
//         const results = []

//         for (const eventType of eventTypes) {
//             try {
//                 // Create test payload
//                 let payload: any = {
//                     userId,
//                     eventType,
//                     timestamp: new Date().toISOString()
//                 }

//                 switch (eventType) {
//                     case 'rebalance':
//                         payload.title = 'Test: Portfolio Rebalanced'
//                         payload.message = 'Test rebalance notification - 3 trades executed'
//                         payload.data = { portfolioId: 'test-123', trades: 3, gasUsed: '0.0234 XLM' }
//                         break
//                     case 'circuitBreaker':
//                         payload.title = 'Test: Circuit Breaker Triggered'
//                         payload.message = 'Test circuit breaker notification - BTC moved 22.5%'
//                         payload.data = { asset: 'BTC', priceChange: '22.5' }
//                         break
//                     case 'priceMovement':
//                         payload.title = 'Test: Large Price Movement'
//                         payload.message = 'Test price movement notification - ETH up 12.34%'
//                         payload.data = { asset: 'ETH', priceChange: '12.34', direction: 'increased' }
//                         break
//                     case 'riskChange':
//                         payload.title = 'Test: Risk Level Changed'
//                         payload.message = 'Test risk change notification - Risk increased to high'
//                         payload.data = { oldLevel: 'medium', newLevel: 'high' }
//                         break
//                 }

//                 await notificationService.notify(payload)
//                 results.push({ eventType, status: 'sent' })
//             } catch (error) {
//                 results.push({ 
//                     eventType, 
//                     status: 'failed', 
//                     error: error instanceof Error ? error.message : String(error) 
//                 })
//             }

//             // Small delay between notifications
//             await new Promise(resolve => setTimeout(resolve, 500))
//         }

//         res.json({
//             success: true,
//             message: 'Test notifications sent',
//             results,
//             sentTo: {
//                 email: preferences.emailEnabled ? preferences.emailAddress : null,
//                 webhook: preferences.webhookEnabled ? preferences.webhookUrl : null
//             },
//             timestamp: new Date().toISOString()
//         })
//     } catch (error) {
//         logger.error('Failed to send test notifications', { error: getErrorObject(error) })
//         res.status(500).json({
//             success: false,
//             error: getErrorMessage(error)
//         })
//     }
// })

// ================================
// DEBUG ROUTES
// ================================

router.get('/debug/coingecko-test', blockDebugInProduction, async (req: Request, res: Response) => {
    try {


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

        res.json({
            apiKeySet: !!apiKey,
            testUrl,
            responseStatus: response.status,
            responseData: data,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            error: getErrorMessage(error),
            stack: error instanceof Error ? error.stack : String(error),
            timestamp: new Date().toISOString()
        })
    }
})

router.get('/debug/force-fresh-prices', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        logger.info('[DEBUG] Clearing cache and forcing fresh prices...')

        // Clear cache first
        reflectorService.clearCache()

        // Get cache status
        const cacheStatus = reflectorService.getCacheStatus()

        // Force a fresh API call
        const result = await reflectorService.getCurrentPrices()

        res.json({
            success: true,
            cacheCleared: true,
            cacheStatusAfterClear: cacheStatus,
            freshPrices: result,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            timestamp: new Date().toISOString()
        })
    }
})

router.get('/debug/reflector-test', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        logger.info('[DEBUG] Testing reflector service...')

        const testResult = await reflectorService.testApiConnectivity()
        const cacheStatus = reflectorService.getCacheStatus()

        res.json({
            success: true,
            apiConnectivityTest: testResult,
            cacheStatus,
            environment: {
                nodeEnv: global.process.env.NODE_ENV,
                apiKeySet: !!global.process.env.COINGECKO_API_KEY,
                apiKeyLength: global.process.env.COINGECKO_API_KEY?.length || 0
            },
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            timestamp: new Date().toISOString()
        })
    }
})

router.get('/debug/env', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        res.json({
            environment: global.process.env.NODE_ENV,
            apiKeySet: !!global.process.env.COINGECKO_API_KEY,
            autoRebalancerEnabled: !!autoRebalancer,
            autoRebalancerRunning: autoRebalancer ? autoRebalancer.getStatus().isRunning : false,
            enableAutoRebalancer: global.process.env.ENABLE_AUTO_REBALANCER,
            port: global.process.env.PORT,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            error: getErrorMessage(error),
            timestamp: new Date().toISOString()
        })
    }
})
router.get('/debug/auto-rebalancer-test', blockDebugInProduction, async (req: Request, res: Response) => {
    try {
        if (!autoRebalancer) {
            return res.json({
                success: false,
                error: 'Auto-rebalancer not initialized',
                autoRebalancerAvailable: false
            })
        }

        const status = autoRebalancer.getStatus()
        const statistics = await autoRebalancer.getStatistics()
        const portfolioCount = await portfolioStorage.getPortfolioCount()

        res.json({
            success: true,
            autoRebalancerAvailable: true,
            status,
            statistics,
            portfolioCount,
            testTimestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            autoRebalancerAvailable: false
        })
    }
})

// ================================
// QUEUE HEALTH ROUTE
// ================================

/**
 * GET /api/queue/health
 * Returns BullMQ queue depths and Redis connectivity status.
 * Used for worker health monitoring and alerting (issue #38).
 */
router.get('/queue/health', async (req: Request, res: Response) => {
    try {
        const metrics = await getQueueMetrics()
        const httpStatus = metrics.redisConnected ? 200 : 503
        res.status(httpStatus).json({
            success: metrics.redisConnected,
            ...metrics,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            redisConnected: false,
            timestamp: new Date().toISOString(),
        })
    }
})

export { router as portfolioRouter }

