import { Router } from 'express'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { RebalanceHistoryService } from '../services/rebalanceHistory.js'
import { RiskManagementService } from '../services/riskManagements.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { CircuitBreakers } from '../services/circuitBreakers.js'
import { analyticsService } from '../services/analyticsService.js'
import { logger } from '../utils/logger.js'
import { requireAdmin } from '../middleware/auth.js'
import { blockDebugInProduction } from '../middleware/debugGate.js'
import { writeRateLimiter } from '../middleware/rateLimit.js'

const router = Router()
const stellarService = new StellarService()
const reflectorService = new ReflectorService()
const rebalanceHistoryService = new RebalanceHistoryService()
const riskManagementService = new RiskManagementService()

// Import autoRebalancer from index.js (will be available after server starts)
let autoRebalancer: any = null
import('../index.js').then(module => {
    autoRebalancer = module.autoRebalancer
}).catch(console.error)

// Helper function for error handling
const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message
    return String(error)
}

const getErrorObject = (error: unknown) => ({
    message: getErrorMessage(error),
    type: error instanceof Error ? error.constructor.name : 'Unknown'
})

// Helper function to convert portfolio allocations to Record<string, number>
const getPortfolioAllocationsAsRecord = (portfolio: any): Record<string, number> => {
    if (Array.isArray(portfolio.allocations)) {
        // Convert array format to object format
        return portfolio.allocations.reduce((acc: Record<string, number>, item: any) => {
            acc[item.asset] = item.target || item.percentage || 0
            return acc
        }, {})
    }
    return portfolio.allocations as Record<string, number>
}

// ================================
// HEALTH CHECK ROUTES
// ================================

// Health check with enhanced status
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        mode: 'demo',
        features: {
            contract_deployed: true,
            real_price_feeds: true,
            automatic_monitoring: true,
            circuit_breakers: true,
            demo_portfolios: true,
            risk_management: true,
            rebalance_history: true,
            auto_rebalancer: autoRebalancer ? autoRebalancer.getStatus().isRunning : false
        }
    })
})

// ================================
// PORTFOLIO MANAGEMENT ROUTES
// ================================

// Create portfolio with enhanced validation
router.post('/portfolio', writeRateLimiter, async (req, res) => {
    try {
        const { userAddress, allocations, threshold } = req.body

        if (!userAddress || !allocations || threshold === undefined) {
            return res.status(400).json({ error: 'Missing required fields: userAddress, allocations, threshold' })
        }

        // Enhanced validation
        const total = Object.values(allocations as Record<string, number>).reduce((sum, val) => sum + val, 0)
        if (Math.abs(total - 100) > 0.01) {
            return res.status(400).json({ error: 'Allocations must sum to 100%' })
        }

        // Validate threshold range
        if (threshold < 1 || threshold > 50) {
            return res.status(400).json({ error: 'Threshold must be between 1% and 50%' })
        }

        // Validate asset allocations
        for (const [asset, percentage] of Object.entries(allocations as Record<string, number>)) {
            if (percentage < 0 || percentage > 100) {
                return res.status(400).json({ error: `Invalid percentage for ${asset}: must be between 0-100%` })
            }
        }

        const portfolioId = await stellarService.createPortfolio(userAddress, allocations, threshold)

        const reflector = new ReflectorService()
        const prices = await reflector.getCurrentPrices()
        await analyticsService.captureSnapshot(portfolioId, prices)

        await rebalanceHistoryService.recordRebalanceEvent({
            portfolioId,
            trigger: 'Portfolio Created',
            trades: 0,
            gasUsed: '0 XLM',
            status: 'completed',
            isAutomatic: false
        })

        logger.info('Portfolio created successfully', {
            portfolioId,
            userAddress,
            allocations,
            threshold,
            mode: 'demo'
        })

        res.json({
            portfolioId,
            status: 'created',
            mode: 'demo',
            message: 'Portfolio created with simulated $10,000 balance'
        })
    } catch (error) {
        logger.error('Failed to create portfolio', { error: getErrorObject(error) })
        res.status(500).json({
            error: getErrorMessage(error)
        })
    }
})

// Get portfolio with real-time data
router.get('/portfolio/:id', async (req, res) => {
    try {
        const portfolioId = req.params.id

        if (!portfolioId) {
            return res.status(400).json({ error: 'Portfolio ID required' })
        }

        const portfolio = await stellarService.getPortfolio(portfolioId)
        const prices = await reflectorService.getCurrentPrices()

        await analyticsService.captureSnapshot(portfolioId, prices)

        let riskMetrics = null
        try {
            const allocationsRecord = getPortfolioAllocationsAsRecord(portfolio)
            riskMetrics = riskManagementService.analyzePortfolioRisk(allocationsRecord, prices)
        } catch (riskError) {
            console.warn('Risk analysis failed:', riskError)
        }

        res.json({
            portfolio,
            prices,
            riskMetrics,
            mode: 'demo',
            lastUpdated: new Date().toISOString()
        })
    } catch (error) {
        logger.error('Failed to fetch portfolio', { error: getErrorObject(error), portfolioId: req.params.id })
        res.status(500).json({
            error: getErrorMessage(error)
        })
    }
})

// Get user portfolios
router.get('/user/:address/portfolios', async (req, res) => {
    try {
        const userAddress = req.params.address
        const portfolios = await portfolioStorage.getUserPortfolios(userAddress)

        res.json(portfolios)
    } catch (error) {
        logger.error('Failed to fetch user portfolios', { error: getErrorObject(error), userAddress: req.params.address })
        res.status(500).json({ error: 'Failed to fetch portfolios' })
    }
})

// ================================
// REBALANCING ROUTES
// ================================

// Enhanced rebalance with comprehensive safety checks
router.post('/portfolio/:id/rebalance', writeRateLimiter, async (req, res) => {
    try {
        const portfolioId = req.params.id

        if (!portfolioId) {
            return res.status(400).json({ error: 'Portfolio ID required' })
        }

        // Get current prices for safety checks
        const prices = await reflectorService.getCurrentPrices()

        // Check circuit breakers before proceeding
        const marketCheck = await CircuitBreakers.checkMarketConditions(prices)
        if (!marketCheck.safe) {
            return res.status(400).json({
                error: `Rebalance blocked by safety systems: ${marketCheck.reason}`,
                reason: 'circuit_breaker',
                canRetry: true
            })
        }

        // Enhanced risk management check
        const portfolio = await stellarService.getPortfolio(portfolioId)
        const riskCheck = riskManagementService.shouldAllowRebalance(portfolio, prices)

        if (!riskCheck.allowed) {
            return res.status(400).json({
                error: `Rebalance blocked by risk management: ${riskCheck.reason}`,
                reason: 'risk_management',
                alerts: riskCheck.alerts,
                canRetry: true
            })
        }

        // Check if rebalance is needed
        const needed = await stellarService.checkRebalanceNeeded(portfolioId)
        if (!needed) {
            return res.status(400).json({
                error: 'Rebalance not needed at this time',
                reason: 'not_needed',
                suggestion: 'Portfolio is already within target allocations'
            })
        }

        const result = await stellarService.executeRebalance(portfolioId)

        await analyticsService.captureSnapshot(portfolioId, prices)

        await rebalanceHistoryService.recordRebalanceEvent({
            portfolioId,
            trigger: 'Manual Rebalance',
            trades: result.trades || 0,
            gasUsed: result.gasUsed || '0 XLM',
            status: 'completed',
            isAutomatic: false,
            riskAlerts: riskCheck.alerts
        })

        logger.info('Rebalance executed successfully', { portfolioId, result })
        res.json({
            result,
            status: 'completed',
            mode: 'demo',
            message: 'Rebalance completed successfully',
            riskAlerts: riskCheck.alerts
        })
    } catch (error) {
        logger.error('Rebalance failed', { error: getErrorObject(error), portfolioId: req.params.id })
        res.status(500).json({
            error: getErrorMessage(error),
            canRetry: !getErrorMessage(error).includes('Cooldown')
        })
    }
})

// Check rebalance status with detailed analysis
router.get('/portfolio/:id/rebalance-status', async (req, res) => {
    try {
        const portfolioId = req.params.id
        const portfolio = await stellarService.getPortfolio(portfolioId)
        const prices = await reflectorService.getCurrentPrices()

        // Check various conditions
        const needed = await stellarService.checkRebalanceNeeded(portfolioId)
        const marketCheck = await CircuitBreakers.checkMarketConditions(prices)
        const cooldownCheck = CircuitBreakers.checkCooldownPeriod(portfolio.lastRebalance)
        const concentrationCheck = CircuitBreakers.checkConcentrationRisk(portfolio.allocations)

        // Enhanced risk management checks with proper type conversion
        const riskCheck = riskManagementService.shouldAllowRebalance(portfolio, prices)
        const allocationsRecord = getPortfolioAllocationsAsRecord(portfolio)
        const riskMetrics = riskManagementService.analyzePortfolioRisk(allocationsRecord, prices)

        res.json({
            needsRebalance: needed,
            canRebalance: needed && marketCheck.safe && cooldownCheck.safe && concentrationCheck.safe && riskCheck.allowed,
            checks: {
                market: marketCheck,
                cooldown: cooldownCheck,
                concentration: concentrationCheck,
                riskManagement: riskCheck
            },
            riskMetrics,
            portfolio: {
                lastRebalance: portfolio.lastRebalance,
                threshold: portfolio.threshold,
                totalValue: portfolio.totalValue
            },
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        logger.error('Failed to check rebalance status', { error: getErrorObject(error) })
        res.status(500).json({ error: 'Failed to check rebalance status' })
    }
})

// ================================
// REBALANCE HISTORY ROUTES
// ================================

// Get rebalance history - FIXED for portfolio-specific data
router.get('/rebalance/history', async (req, res) => {
    try {
        const portfolioId = req.query.portfolioId as string
        const limit = parseInt(req.query.limit as string) || 50

        console.log(`[DEBUG] Rebalance history request - portfolioId: ${portfolioId || 'all'}`)

        if (portfolioId) {
            const portfolio = await portfolioStorage.getPortfolio(portfolioId)
            if (!portfolio) {
                console.log(`[DEBUG] Portfolio ${portfolioId} not found`)
                return res.json({
                    success: true,
                    history: [],
                    count: 0,
                    message: 'No history found for this portfolio'
                })
            }

            // Get history for this specific portfolio
            let history = await rebalanceHistoryService.getRebalanceHistory(portfolioId, limit)

            // If no history, create initial event
            if (history.length === 0) {
                console.log(`[DEBUG] Creating initial history for portfolio ${portfolioId}`)
                await rebalanceHistoryService.recordRebalanceEvent({
                    portfolioId,
                    trigger: 'Portfolio Created',
                    trades: 0,
                    gasUsed: '0 XLM',
                    status: 'completed',
                    isAutomatic: false
                })
                history = await rebalanceHistoryService.getRebalanceHistory(portfolioId, limit)
            }

            console.log(`[DEBUG] Returning ${history.length} events for portfolio ${portfolioId}`)
            return res.json({
                success: true,
                history,
                count: history.length,
                portfolioId
            })
        } else {
            // Return general history for dashboard
            const history = await rebalanceHistoryService.getRebalanceHistory(undefined, limit)
            return res.json({
                success: true,
                history,
                count: history.length
            })
        }

    } catch (error) {
        console.error('[ERROR] Rebalance history failed:', error)
        res.json({
            success: false,
            error: getErrorMessage(error),
            history: []
        })
    }
})

// Record new rebalance event
router.post('/rebalance/history', async (req, res) => {
    try {
        const eventData = req.body

        console.log('[INFO] Recording new rebalance event:', eventData)

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
        console.error('[ERROR] Failed to record rebalance event:', error)
        res.status(500).json({
            success: false,
            error: getErrorMessage(error)
        })
    }
})

// ================================
// RISK MANAGEMENT ROUTES
// ================================

// Get risk metrics for a portfolio
router.get('/risk/metrics/:portfolioId', async (req, res) => {
    try {
        const { portfolioId } = req.params

        console.log(`[INFO] Calculating risk metrics for portfolio: ${portfolioId}`)

        const portfolio = await stellarService.getPortfolio(portfolioId)
        const prices = await reflectorService.getCurrentPrices()

        // Calculate risk metrics with proper type conversion
        const allocationsRecord = getPortfolioAllocationsAsRecord(portfolio)
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
        console.error('[ERROR] Failed to get risk metrics:', error)
        res.status(500).json({
            success: false,
            error: getErrorMessage(error),
            riskMetrics: {
                volatility: 0,
                concentrationRisk: 0,
                liquidityRisk: 0,
                correlationRisk: 0,
                overallRiskLevel: 'low' as const
            }
        })
    }
})

// Check if rebalancing should be allowed based on risk conditions
router.get('/risk/check/:portfolioId', async (req, res) => {
    try {
        const { portfolioId } = req.params

        console.log(`[INFO] Checking risk conditions for portfolio: ${portfolioId}`)

        const portfolio = await stellarService.getPortfolio(portfolioId)
        const prices = await reflectorService.getCurrentPrices()

        const riskCheck = riskManagementService.shouldAllowRebalance(portfolio, prices)

        res.json({
            success: true,
            portfolioId,
            ...riskCheck,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        console.error('[ERROR] Failed to check risk conditions:', error)
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
router.get('/prices', async (req, res) => {
    try {
        console.log('[DEBUG] Fetching prices for frontend...')
        const prices = await reflectorService.getCurrentPrices()

        console.log('[DEBUG] Raw prices from service:', prices)

        // Return prices directly in the format frontend expects
        res.json(prices)

    } catch (error) {
        console.error('[ERROR] Prices endpoint failed:', error)

        // Always return valid fallback data in correct format
        const fallbackPrices = {
            XLM: { price: 0.358878, change: -0.60, timestamp: Date.now() / 1000, source: 'fallback' },
            BTC: { price: 111150, change: 0.23, timestamp: Date.now() / 1000, source: 'fallback' },
            ETH: { price: 4384.56, change: -0.15, timestamp: Date.now() / 1000, source: 'fallback' },
            USDC: { price: 0.999781, change: -0.002, timestamp: Date.now() / 1000, source: 'fallback' }
        }

        console.log('[DEBUG] Sending fallback prices:', fallbackPrices)
        res.json(fallbackPrices)
    }
})

// Enhanced prices endpoint with risk analysis
router.get('/prices/enhanced', async (req, res) => {
    try {
        console.log('[INFO] Fetching enhanced prices with risk analysis')

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
        console.error('[ERROR] Failed to fetch enhanced prices:', error)
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
router.get('/market/:asset/details', async (req, res) => {
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
router.get('/market/:asset/chart', async (req, res) => {
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

router.get('/auto-rebalancer/status', requireAdmin, async (req, res) => {
// Get auto-rebalancer status
router.get('/auto-rebalancer/status', async (req, res) => {
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

router.post('/auto-rebalancer/start', requireAdmin, (req, res) => {
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

router.post('/auto-rebalancer/stop', requireAdmin, (req, res) => {
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

router.post('/auto-rebalancer/force-check', requireAdmin, async (req, res) => {
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

router.get('/auto-rebalancer/history', requireAdmin, async (req, res) => {
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
router.get('/system/status', async (req, res) => {
    try {
        const portfolioCount = await portfolioStorage.getPortfolioCount()
        const historyStats = await rebalanceHistoryService.getHistoryStats()
        const circuitBreakers = riskManagementService.getCircuitBreakerStatus()

        // Check API health
        const prices = await reflectorService.getCurrentPrices()
        const priceSourcesHealthy = Object.keys(prices).length > 0

        // Auto-rebalancer status
        const autoRebalancerStatus = autoRebalancer ? autoRebalancer.getStatus() : { isRunning: false }
        const autoRebalancerStats = autoRebalancer ? await autoRebalancer.getStatistics() : null

        res.json({
            success: true,
            system: {
                status: 'operational',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            },
            portfolios: {
                total: portfolioCount,
                active: portfolioCount // Assuming all are active for demo
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
            services: {
                priceFeeds: priceSourcesHealthy,
                riskManagement: true,
                webSockets: true,
                autoRebalancing: autoRebalancerStatus.isRunning,
                stellarNetwork: true
            }
        })
    } catch (error) {
        console.error('[ERROR] Failed to get system status:', error)
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

router.get('/portfolio/:id/analytics', async (req, res) => {
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

router.get('/portfolio/:id/performance-summary', async (req, res) => {
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
// DEBUG ROUTES
// ================================

router.get('/debug/coingecko-test', blockDebugInProduction, async (req, res) => {
    try {
        const apiKey = process.env.COINGECKO_API_KEY
        console.log('[DEBUG] API Key exists:', !!apiKey)

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

        console.log('[DEBUG] Test URL:', testUrl)

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

router.get('/debug/force-fresh-prices', blockDebugInProduction, async (req, res) => {
    try {
        console.log('[DEBUG] Clearing cache and forcing fresh prices...')

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

router.get('/debug/reflector-test', blockDebugInProduction, async (req, res) => {
    try {
        console.log('[DEBUG] Testing reflector service...')

        const testResult = await reflectorService.testApiConnectivity()
        const cacheStatus = reflectorService.getCacheStatus()

        res.json({
            success: true,
            apiConnectivityTest: testResult,
            cacheStatus,
            environment: {
                nodeEnv: process.env.NODE_ENV,
                apiKeySet: !!process.env.COINGECKO_API_KEY,
                apiKeyLength: process.env.COINGECKO_API_KEY?.length || 0
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

router.get('/debug/env', blockDebugInProduction, async (req, res) => {
    try {
        res.json({
            environment: process.env.NODE_ENV,
            apiKeySet: !!process.env.COINGECKO_API_KEY,
            autoRebalancerEnabled: !!autoRebalancer,
            autoRebalancerRunning: autoRebalancer ? autoRebalancer.getStatus().isRunning : false,
            enableAutoRebalancer: process.env.ENABLE_AUTO_REBALANCER,
            port: process.env.PORT,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        res.status(500).json({
            error: getErrorMessage(error),
            timestamp: new Date().toISOString()
        })
    }
})

router.get('/debug/auto-rebalancer-test', blockDebugInProduction, async (req, res) => {
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

export { router as portfolioRouter }