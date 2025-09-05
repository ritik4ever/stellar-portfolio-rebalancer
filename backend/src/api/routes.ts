import { Router } from 'express'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { CircuitBreakers } from '../services/circuitBreakers.js'
import { logger } from '../utils/logger.js'

const router = Router()
const stellarService = new StellarService()
const reflectorService = new ReflectorService()

// Helper function for error handling
const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message
    return String(error)
}

const getErrorObject = (error: unknown) => ({
    message: getErrorMessage(error),
    type: error instanceof Error ? error.constructor.name : 'Unknown'
})

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
            demo_portfolios: true
        }
    })
})

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

        res.json({
            portfolio,
            prices,
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
            message: 'Rebalance completed successfully'
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

        res.json({
            needsRebalance: needed,
            canRebalance: needed && marketCheck.safe && cooldownCheck.safe && concentrationCheck.safe,
            checks: {
                market: marketCheck,
                cooldown: cooldownCheck,
                concentration: concentrationCheck
            },
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

// Get current prices with enhanced metadata
router.get('/prices', async (req, res) => {
    try {
        const prices = await reflectorService.getCurrentPrices()

        // Add metadata about price sources and quality
        const pricesWithMetadata = Object.entries(prices).reduce((acc, [asset, data]) => {
            acc[asset] = {
                ...data,
                source: 'external_api',
                quality: 'good',
                staleness: Date.now() / 1000 - (data.timestamp || 0)
            }
            return acc
        }, {} as Record<string, any>)

        res.json({
            prices: pricesWithMetadata,
            metadata: {
                source: 'reflector_with_fallback',
                lastUpdate: new Date().toISOString(),
                updateFrequency: '30_seconds',
                assets: Object.keys(prices).length
            }
        })
    } catch (error) {
        logger.error('Failed to fetch prices', { error: getErrorObject(error) })
        res.status(500).json({ error: 'Failed to fetch prices' })
    }
})

export { router as portfolioRouter }