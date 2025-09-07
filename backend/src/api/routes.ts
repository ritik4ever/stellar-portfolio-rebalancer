import { Router } from 'express'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { RebalanceHistoryService } from '../services/rebalanceHistory.js'
import { RiskManagementService } from '../services/riskManagements.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { CircuitBreakers } from '../services/circuitBreakers.js'
import { logger } from '../utils/logger.js'

const router = Router()
const stellarService = new StellarService()
const reflectorService = new ReflectorService()
const rebalanceHistoryService = new RebalanceHistoryService()
const riskManagementService = new RiskManagementService()

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
            rebalance_history: true
        }
    })
})

// ================================
// PORTFOLIO MANAGEMENT ROUTES
// ================================

// Create portfolio with enhanced validation
router.post('/portfolio', async (req, res) => {
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

        // Record initial portfolio creation event
        await rebalanceHistoryService.recordRebalanceEvent({
            portfolioId,
            trigger: 'Portfolio Created',
            trades: 0,
            gasUsed: '0 XLM',
            status: 'completed'
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

        // Get risk analysis with proper type conversion
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
        const portfolios = portfolioStorage.getUserPortfolios(userAddress)

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
router.post('/portfolio/:id/rebalance', async (req, res) => {
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
            // Check if portfolio exists
            const portfolio = portfolioStorage.getPortfolio(portfolioId)
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
                    status: 'completed'
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

        const event = await rebalanceHistoryService.recordRebalanceEvent(eventData)

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
        const enhancedPrices = Object.entries(prices).reduce((acc, [asset, data]) => {
            acc[asset] = {
                ...data,
                riskAlerts: riskAlerts.filter((alert: any) => alert.asset === asset),
                volatilityLevel: Math.abs(data.change || 0) > 10 ? 'high' :
                    Math.abs(data.change || 0) > 5 ? 'medium' : 'low'
            }
            return acc
        }, {} as Record<string, any>)

        res.json({
            success: true,
            prices: enhancedPrices,
            riskAlerts,
            circuitBreakers: riskManagementService.getCircuitBreakerStatus(),
            metadata: {
                source: 'enhanced_with_risk_analysis',
                lastUpdate: new Date().toISOString(),
                alertsCount: riskAlerts.length,
                assets: Object.keys(prices).length
            }
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
// SYSTEM STATUS ROUTES
// ================================

// Get comprehensive system status
router.get('/system/status', async (req, res) => {
    try {
        const portfolioCount = portfolioStorage.portfolios.size
        const historyStats = rebalanceHistoryService.getHistoryStats()
        const circuitBreakers = riskManagementService.getCircuitBreakerStatus()

        // Check API health
        const prices = await reflectorService.getCurrentPrices()
        const priceSourcesHealthy = Object.keys(prices).length > 0

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
            services: {
                priceFeeds: priceSourcesHealthy,
                riskManagement: true,
                webSockets: true,
                autoRebalancing: true,
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

export { router as portfolioRouter }