import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { portfolioRouter } from './api/routes.js'
import { v1Router } from './api/v1Router.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { globalRateLimiter } from './middleware/rateLimit.js'
import { legacyApiDeprecation } from './middleware/legacyApiDeprecation.js'
import { RebalancingService } from './monitoring/rebalancer.js'
import { AutoRebalancerService } from './services/autoRebalancer.js'
import { contractEventIndexerService } from './services/contractEventIndexer.js'
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

let startupConfig: StartupConfig
try {
    startupConfig = validateStartupConfigOrThrow(process.env)
    logger.info('[STARTUP-CONFIG] Validation successful', buildStartupSummary(startupConfig))
} catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
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

// Basic logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`)
    next()
})

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
        console.log('[TEST] Testing CoinGecko API...')
        const { ReflectorService } = await import('./services/reflector.js')
        const reflector = new ReflectorService()

        // Test connectivity first
        const testResult = await reflector.testApiConnectivity()

        if (!testResult.success) {
            return res.status(500).json({
                success: false,
                error: testResult.error
            })
        }

        // Try to get actual prices
        reflector.clearCache()
        const prices = await reflector.getCurrentPrices()

        res.json({
            success: true,
            prices,
            testResult,
            environment: process.env.NODE_ENV
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error)
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
            corsTest: '/test/cors',
            coinGeckoTest: '/test/coingecko',
            autoRebalancerStatus: '/api/v1/auto-rebalancer/status',
            queueHealth: '/api/v1/queue/health'
        }
    })
})

// Mount API routes
app.use('/api/v1', v1Router)
app.use('/api', legacyApiDeprecation, portfolioRouter)
app.use('/', legacyApiDeprecation, portfolioRouter)

// 404 handler
app.use((req, res) => {
    console.log(`404 - Route not found: ${req.method} ${req.url}`)
    res.status(404).json({
        error: 'Route not found',
        method: req.method,
        url: req.url,
        availableEndpoints: {
            health: '/health',
            api: '/api/v1/*',
            legacyApi: '/api/*',
            autoRebalancer: '/api/v1/auto-rebalancer/*',
            queueHealth: '/api/v1/queue/health'
        }
    })
})

// Error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Server error:', error)
    res.status(500).json({
        error: 'Internal server error',
        message: error.message || 'Unknown error'
    })
})

// Create server
const server = createServer(app)

// WebSocket setup
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
    console.log('WebSocket connection established')
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected',
        autoRebalancerStatus: autoRebalancer.getStatus()
    }))

    ws.on('error', (error) => {
        console.error('WebSocket error:', error)
    })
})

// Start existing rebalancing service (now queue-backed, no cron)
try {
    const rebalancingService = new RebalancingService(wss)
    rebalancingService.start()
    console.log('[REBALANCING-SERVICE] Monitoring service started (queue-backed)')
} catch (error) {
    console.error('Failed to start rebalancing service:', error)
}

// Start server
server.listen(port, async () => {
    console.log(`🚀 Server running on port ${port}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`CoinGecko API Key: ${!!process.env.COINGECKO_API_KEY ? 'SET' : 'NOT SET'}`)

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
            console.log('[SCHEDULER] ✅ Queue scheduler registered')
        } catch (err) {
            console.error('[SCHEDULER] ❌ Failed to register scheduler:', err)
        }
    }

    // ── Auto-rebalancer (queue-backed) ──────────────────────────────────────
    const shouldStartAutoRebalancer =
        process.env.NODE_ENV === 'production' ||
        process.env.ENABLE_AUTO_REBALANCER === 'true'

    if (shouldStartAutoRebalancer) {
        try {
            console.log('[AUTO-REBALANCER] Starting automatic rebalancing service...')
            await autoRebalancer.start()
            console.log('[AUTO-REBALANCER] ✅ Automatic rebalancing service started successfully')

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
            console.error('[AUTO-REBALANCER] ❌ Failed to start automatic rebalancing service:', error)
        }
    } else {
        console.log('[AUTO-REBALANCER] Automatic rebalancing disabled in development mode')
        console.log('[AUTO-REBALANCER] Set ENABLE_AUTO_REBALANCER=true to enable in development')
    }

    console.log('Available endpoints:')
    console.log(`  Health: http://localhost:${port}/health`)
    console.log(`  CORS Test: http://localhost:${port}/test/cors`)
    console.log(`  CoinGecko Test: http://localhost:${port}/test/coingecko`)
    console.log(`  Auto-Rebalancer Status: http://localhost:${port}/api/v1/auto-rebalancer/status`)
    console.log(`  Queue Health: http://localhost:${port}/api/v1/queue/health`)
    console.log(`  Legacy API (Deprecated): http://localhost:${port}/api/*`)
})

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
    console.log(`\n[SHUTDOWN] ${signal} received, shutting down gracefully...`)

    // Stop auto-rebalancer
    try {
        autoRebalancer.stop()
        console.log('[SHUTDOWN] Auto-rebalancer stopped')
    } catch (error) {
        console.error('[SHUTDOWN] Error stopping auto-rebalancer:', error)
    }

    // Stop BullMQ workers
    try {
        await Promise.all([
            stopPortfolioCheckWorker(),
            stopRebalanceWorker(),
            stopAnalyticsSnapshotWorker(),
        ])
        console.log('[SHUTDOWN] BullMQ workers stopped')
    } catch (error) {
        console.error('[SHUTDOWN] Error stopping BullMQ workers:', error)
    }

    // Close BullMQ queues
    try {
        await closeAllQueues()
        console.log('[SHUTDOWN] BullMQ queues closed')
    } catch (error) {
        console.error('[SHUTDOWN] Error closing queues:', error)
    }

    // Close database connection
    try {
        databaseService.close()
        console.log('[SHUTDOWN] Database connection closed')
    } catch (error) {
        console.error('[SHUTDOWN] Error closing database:', error)
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
            console.error('[SHUTDOWN] Error closing server:', err)
            process.exit(1)
        }
        console.log('[SHUTDOWN] Server closed successfully')
        process.exit(0)
    })

    // Force exit after 10 seconds
    setTimeout(() => {
        console.log('[SHUTDOWN] Force exit after timeout')
        process.exit(1)
    }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT-EXCEPTION] Uncaught exception:', error)
    gracefulShutdown('UNCAUGHT_EXCEPTION')
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED-REJECTION] Unhandled promise rejection:', reason)
    console.error('Promise:', promise)
})

// Export instances for use in routes
export { autoRebalancer }
export default app
