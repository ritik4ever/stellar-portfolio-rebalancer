import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { portfolioRouter } from './api/routes.js'
import { authRouter } from './api/authRoutes.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { globalRateLimiter, burstProtectionLimiter, requestMonitoringMiddleware, closeRateLimitStore } from './middleware/rateLimit.js'
import { RebalancingService } from './monitoring/rebalancer.js'
import { AutoRebalancerService } from './services/autoRebalancer.js'
import { logger } from './utils/logger.js'
import { databaseService } from './services/databaseService.js'
import { validateStartupConfigOrThrow, buildStartupSummary, type StartupConfig } from './config/startupConfig.js'
import { getFeatureFlags, getPublicFeatureFlags } from './config/featureFlags.js'
import { isRedisAvailable, logQueueStartup } from './queue/connection.js'
import { closeAllQueues } from './queue/queues.js'
import { startQueueScheduler } from './queue/scheduler.js'
import { startPortfolioCheckWorker, stopPortfolioCheckWorker } from './queue/workers/portfolioCheckWorker.js'
import { startRebalanceWorker, stopRebalanceWorker } from './queue/workers/rebalanceWorker.js'
import { startAnalyticsSnapshotWorker, stopAnalyticsSnapshotWorker } from './queue/workers/analyticsSnapshotWorker.js'
import { contractEventIndexerService } from './services/contractEventIndexer.js'
import { requestContextMiddleware } from './middleware/requestContext.js'
import { apiErrorHandler } from './middleware/apiErrorHandler.js'
import { initRobustWebSocket } from './services/websocket.service.js'

let startupConfig: StartupConfig
try {
    startupConfig = validateStartupConfigOrThrow(process.env)
    logger.info('[STARTUP-CONFIG] Validation successful', buildStartupSummary(startupConfig))
} catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(message)
    process.exit(1)
}

const app = express()
const port = startupConfig.port
const featureFlags = getFeatureFlags()
const publicFeatureFlags = getPublicFeatureFlags()

const isProduction = startupConfig.nodeEnv === 'production'
const allowedOrigins = startupConfig.corsOrigins

const corsOptions: cors.CorsOptions = {
    origin: isProduction
        ? allowedOrigins.length > 0
            ? (origin, cb) => {
                if (!origin || allowedOrigins.includes(origin)) cb(null, origin || true)
                else cb(new Error('Not allowed by CORS'))
            }
            : false
        : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With', 'X-Public-Key', 'X-Message', 'X-Signature']
}
app.use(cors(corsOptions))

app.options('*', (req, res) => {
    const origin = req.get('Origin')
    if (isProduction && allowedOrigins.length > 0) {
        if (origin && allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
    } else {
        res.setHeader('Access-Control-Allow-Origin', origin || '*')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, X-Public-Key, X-Message, X-Signature')
    res.status(204).end()
})

// Trust proxy
app.set('trust proxy', 1)

// Body parsing
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Request context + structured request logging
app.use(requestContextMiddleware)

// Request monitoring for rate limiting metrics
app.use(requestMonitoringMiddleware)

// Rate limiting - burst protection first, then global limits
app.use(burstProtectionLimiter)
app.use(globalRateLimiter)

// Create auto-rebalancer instance
const autoRebalancer = new AutoRebalancerService()

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        autoRebalancer: autoRebalancer ? autoRebalancer.getStatus() : { isRunning: false }
    })
})

// CORS test endpoint
app.get('/test/cors', (req, res) => {
    if (!featureFlags.enableDebugRoutes) {
        return res.status(404).json({ error: 'Route not found' })
    }
    res.json({
        success: true,
        message: 'CORS working!',
        origin: req.get('Origin'),
        timestamp: new Date().toISOString()
    })
})

// CoinGecko test endpoint with detailed debugging
app.get('/test/coingecko', async (req, res) => {
    if (!featureFlags.enableDebugRoutes) {
        return res.status(404).json({ error: 'Route not found' })
    }
    try {
        logger.info('[TEST] Testing CoinGecko API...')
        const { ReflectorService } = await import('./services/reflector.js')
        const reflector = new ReflectorService()

        // Test connectivity first
        const testResult = await reflector.testApiConnectivity()

        if (!testResult.success) {
            return res.status(500).json({
                success: false,
                error: testResult.error,
                hasApiKey: !!process.env.COINGECKO_API_KEY,
                apiKeyLength: process.env.COINGECKO_API_KEY?.length || 0
            })
        }

        // Try to get actual prices
        reflector.clearCache()
        const prices = await reflector.getCurrentPrices()

        res.json({
            success: true,
            prices,
            hasApiKey: !!process.env.COINGECKO_API_KEY,
            apiKeyLength: process.env.COINGECKO_API_KEY?.length || 0,
            testResult,
            environment: process.env.NODE_ENV
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            hasApiKey: !!process.env.COINGECKO_API_KEY
        })
    }
})
// Root route
app.get('/', (req, res) => {
    res.json({
        message: 'Stellar Portfolio Rebalancer API',
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        features: {
            automaticRebalancing: !!autoRebalancer?.getStatus().isRunning,
            priceFeeds: true,
            riskManagement: true,
            portfolioManagement: true,
            featureFlags: publicFeatureFlags
        },
        endpoints: {
            health: '/health',
            apiDocs: '/api-docs',
            corsTest: '/test/cors',
            coinGeckoTest: '/test/coingecko',
            autoRebalancerStatus: '/api/auto-rebalancer/status',
            queueHealth: '/api/queue/health'
        }
    })
})

// Mount API routes
app.use('/api/auth', authRouter)
app.use('/api', portfolioRouter)
app.use('/api/v1', portfolioRouter)
app.use('/api', apiErrorHandler)

// Legacy non-/api compatibility (redirect only)
const LEGACY_API_PREFIXES = [
    '/portfolio',
    '/user',
    '/prices',
    '/prices/enhanced',
    '/market',
    '/rebalance',
    '/risk',
    '/auto-rebalancer',
    '/notifications',
    '/system',
    '/queue',
    '/debug'
]

const PUBLIC_ROOT_PATHS = new Set(['/', '/health', '/test/cors', '/test/coingecko'])

app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    if (PUBLIC_ROOT_PATHS.has(req.path)) return next()

    const matchesLegacy = LEGACY_API_PREFIXES.some((prefix) =>
        req.path === prefix || req.path.startsWith(`${prefix}/`)
    )

    if (!matchesLegacy) return next()

    const target = `/api${req.originalUrl}`
    if (process.env.LEGACY_API_REDIRECT === 'false') {
        return res.status(410).json({
            error: 'Legacy API path removed. Use /api/* endpoints.',
            target
        })
    }

    return res.redirect(308, target)
})

// 404 handler
app.use((req, res) => {
    logger.warn('Route not found', { method: req.method, url: req.url })
    res.status(404).json({
        error: 'Route not found',
        method: req.method,
        url: req.url,
        availableEndpoints: {
            health: '/health',
            api: '/api/*',
            autoRebalancer: '/api/auto-rebalancer/*',
            queueHealth: '/api/queue/health'
        }
    })
})

// Error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Server error', { error })
    res.status(500).json({
        error: 'Internal server error',
        message: error.message || 'Unknown error'
    })
})

// Create server
const server = createServer(app)

// WebSocket setup
const wss = new WebSocketServer({ server })



// Start existing rebalancing service (now queue-backed, no cron)
try {
    const rebalancingService = new RebalancingService(wss)
    rebalancingService.start()
    logger.info('[REBALANCING-SERVICE] Monitoring service started (queue-backed)')
} catch (error) {
    logger.error('Failed to start rebalancing service', { error })
}

// Start server
server.listen(port, async () => {
    logger.info('Server listening', {
        port,
        environment: process.env.NODE_ENV || 'development',
        coinGeckoApiKeySet: !!process.env.COINGECKO_API_KEY
    })

    // ── BullMQ / Redis setup ────────────────────────────────────────────────
    const redisAvailable = await isRedisAvailable()
    logQueueStartup(redisAvailable)

    if (redisAvailable) {
        // Start all three workers
        startPortfolioCheckWorker()
        startRebalanceWorker()
        startAnalyticsSnapshotWorker()

        // Register repeatable jobs (scheduler)
        try {
            await startQueueScheduler()
            logger.info('[SCHEDULER] Queue scheduler registered')
        } catch (err) {
            logger.error('[SCHEDULER] Failed to register scheduler', { error: err })
        }
    }

    // ── Auto-rebalancer (queue-backed) ──────────────────────────────────────
    const shouldStartAutoRebalancer =
        process.env.NODE_ENV === 'production' ||
        process.env.ENABLE_AUTO_REBALANCER === 'true'

    if (shouldStartAutoRebalancer) {
        try {
            logger.info('[AUTO-REBALANCER] Starting automatic rebalancing service...')
            await autoRebalancer.start()
            logger.info('[AUTO-REBALANCER] Automatic rebalancing service started successfully')

            // Broadcast to WebSocket clients
            wss.clients.forEach(client => {
                if (client.readyState === client.OPEN) {
                    client.send(JSON.stringify({
                        type: 'autoRebalancerStarted',
                        status: autoRebalancer.getStatus(),
                        timestamp: new Date().toISOString()
                    }))
                }
            })
        } catch (error) {
            logger.error('[AUTO-REBALANCER] Failed to start automatic rebalancing service', { error })
        }
    } else {
        logger.info('[AUTO-REBALANCER] Automatic rebalancing disabled in development mode')
        logger.info('[AUTO-REBALANCER] Set ENABLE_AUTO_REBALANCER=true to enable in development')
    }

    // Contract event indexer (on-chain source-of-truth history)
    try {
        await contractEventIndexerService.start()
    } catch (error) {
        logger.error('[CHAIN-INDEXER] Failed to start', { error })
    }

    logger.info('Available endpoints', {
        health: `/health`,
        corsTest: `/test/cors`,
        coinGeckoTest: `/test/coingecko`,
        autoRebalancerStatus: `/api/auto-rebalancer/status`,
        queueHealth: `/api/queue/health`,
    })
})

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
    logger.info('[SHUTDOWN] Signal received, shutting down gracefully', { signal })

    // Stop auto-rebalancer
    try {
        autoRebalancer.stop()
        logger.info('[SHUTDOWN] Auto-rebalancer stopped')
    } catch (error) {
        logger.error('[SHUTDOWN] Error stopping auto-rebalancer', { error })
    }

    // Stop BullMQ workers
    try {
        await Promise.all([
            stopPortfolioCheckWorker(),
            stopRebalanceWorker(),
            stopAnalyticsSnapshotWorker(),
        ])
        logger.info('[SHUTDOWN] BullMQ workers stopped')
    } catch (error) {
        logger.error('[SHUTDOWN] Error stopping BullMQ workers', { error })
    }

    // Close BullMQ queues
    try {
        await closeAllQueues()
        logger.info('[SHUTDOWN] BullMQ queues closed')
    } catch (error) {
        logger.error('[SHUTDOWN] Error closing queues', { error })
    }

    // Close rate limiting Redis store
    try {
        await closeRateLimitStore()
        logger.info('[SHUTDOWN] Rate limiting Redis store closed')
    } catch (error) {
        logger.error('[SHUTDOWN] Error closing rate limiting store', { error })
    }

    // Close database connection
    try {
        await contractEventIndexerService.stop()
        logger.info('[SHUTDOWN] Contract event indexer stopped')
    } catch (error) {
        logger.error('[SHUTDOWN] Error stopping contract event indexer', { error })
    }

    try {
        databaseService.close()
        logger.info('[SHUTDOWN] Database connection closed')
    } catch (error) {
        logger.error('[SHUTDOWN] Error closing database', { error })
    }

    // Close WebSocket connections
    wss.clients.forEach(client => {
        client.send(JSON.stringify({
            type: 'serverShutdown',
            message: 'Server is shutting down',
            timestamp: new Date().toISOString()
        }))
        client.close()
    })

    // Close server
    server.close((err) => {
        if (err) {
            logger.error('[SHUTDOWN] Error closing server', { error: err })
            process.exit(1)
        }
        logger.info('[SHUTDOWN] Server closed successfully')
        process.exit(0)
    })

    // Force exit after 10 seconds
    setTimeout(() => {
        logger.warn('[SHUTDOWN] Force exit after timeout')
        process.exit(1)
    }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('[UNCAUGHT-EXCEPTION] Uncaught exception', { error })
    gracefulShutdown('UNCAUGHT_EXCEPTION')
})

process.on('unhandledRejection', (reason, promise) => {
    logger.error('[UNHANDLED-REJECTION] Unhandled promise rejection', { reason, promise })
})

// Export instances for use in routes
export { autoRebalancer }
export default app
