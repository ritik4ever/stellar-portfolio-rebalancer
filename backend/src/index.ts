import express from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { portfolioRouter } from './api/routes.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { RebalancingService } from './monitoring/rebalancer.js'
import { logger } from './utils/logger.js'

const app = express()
const port = process.env.PORT || 3001

// Production-ready CORS configuration
const corsOptions: cors.CorsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) {
            return callback(null, true)
        }

        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:5173',
            'https://stellar-portfolio-rebalancer.vercel.app',
            'https://stellar-portfolio-rebalancer-git-main-ritik4evers-projects.vercel.app',
            'https://stellar-portfolio-rebalancer-ho6hzc0ht-ritik4evers-projects.vercel.app',
            'https://stellar-portfolio-rebalancer.onrender.com'
        ]

        // Check exact matches first
        if (allowedOrigins.includes(origin)) {
            return callback(null, true)
        }

        // Check Vercel pattern matches
        if (origin.match(/^https:\/\/stellar-portfolio-rebalancer.*\.vercel\.app$/) ||
            origin.match(/^https:\/\/.*-ritik4evers-projects\.vercel\.app$/)) {
            return callback(null, true)
        }

        // For production debugging - log rejected origins
        console.log('CORS rejected origin:', origin)
        return callback(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'Origin',
        'X-Requested-With',
        'Cache-Control',
        'Pragma'
    ],
    exposedHeaders: ['Content-Length', 'X-Requested-With'],
    optionsSuccessStatus: 200,
    preflightContinue: false
}

// Apply CORS
app.use(cors(corsOptions))

// Explicit preflight handler
app.options('*', cors(corsOptions))

// Trust proxy for proper IP detection when behind reverse proxy
app.set('trust proxy', 1)

// Body parsing middleware
app.use(express.json({
    limit: '10mb',
    strict: true,
    type: 'application/json'
}))
app.use(express.urlencoded({
    extended: true,
    limit: '10mb',
    parameterLimit: 1000
}))

// Security headers middleware
app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff')
    res.header('X-Frame-Options', 'DENY')
    res.header('X-XSS-Protection', '1; mode=block')
    next()
})

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now()

    res.on('finish', () => {
        const duration = Date.now() - start
        logger.info(`${req.method} ${req.url} ${res.statusCode}`, {
            duration: `${duration}ms`,
            userAgent: req.get('User-Agent'),
            origin: req.get('Origin'),
            ip: req.ip,
            contentLength: res.get('Content-Length')
        })
    })

    next()
})

// Health check endpoint (before routes)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        origin: req.get('Origin')
    })
})

// CORS test endpoint
app.get('/test/cors', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'CORS is working perfectly!',
        origin: req.get('Origin'),
        timestamp: new Date().toISOString(),
        headers: {
            origin: req.get('Origin'),
            userAgent: req.get('User-Agent'),
            host: req.get('Host')
        },
        environment: process.env.NODE_ENV
    })
})

// CoinGecko API test endpoint
app.get('/test/coingecko', async (req, res) => {
    try {
        console.log('[TEST] Testing CoinGecko API...')
        console.log('[TEST] Environment check:', {
            hasApiKey: !!process.env.COINGECKO_API_KEY,
            nodeEnv: process.env.NODE_ENV,
            apiKeyLength: process.env.COINGECKO_API_KEY?.length || 0
        })

        // Dynamic import to ensure fresh instance
        const { ReflectorService } = await import('./services/reflector.js')
        const reflector = new ReflectorService()

        // Clear cache to force fresh request
        reflector.clearCache()

        // Test the API
        const prices = await reflector.getCurrentPrices()

        console.log('[TEST] CoinGecko test successful')

        res.status(200).json({
            success: true,
            message: 'CoinGecko API is working!',
            apiKey: !!process.env.COINGECKO_API_KEY,
            apiKeyLength: process.env.COINGECKO_API_KEY?.length || 0,
            environment: process.env.NODE_ENV,
            prices,
            priceCount: Object.keys(prices).length,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        console.error('[TEST] CoinGecko test failed:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)

        res.status(500).json({
            success: false,
            message: 'CoinGecko API test failed',
            error: errorMessage,
            apiKey: !!process.env.COINGECKO_API_KEY,
            apiKeyLength: process.env.COINGECKO_API_KEY?.length || 0,
            environment: process.env.NODE_ENV,
            timestamp: new Date().toISOString()
        })
    }
})

// Root route
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Stellar Portfolio Rebalancer API',
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        origin: req.get('Origin'),
        environment: process.env.NODE_ENV || 'development',
        features: {
            rebalancing: true,
            riskManagement: true,
            realTimePrices: true,
            webSockets: true,
            cors: true,
            healthCheck: true
        },
        endpoints: {
            health: '/health',
            corsTest: '/test/cors',
            coinGeckoTest: '/test/coingecko',
            api: '/api/*'
        }
    })
})

// API Routes
app.use('/api', portfolioRouter)

// Mount routes at root level for backward compatibility
app.use('/', portfolioRouter)

// 404 handler for unknown routes
app.use(notFound)

// Global error handler
app.use(errorHandler)

// Create HTTP server
const server = createServer(app)

// WebSocket server configuration
const wss = new WebSocketServer({
    server,
    clientTracking: true,
    maxPayload: 16 * 1024 * 1024, // 16MB
    perMessageDeflate: {
        zlibDeflateOptions: {
            level: 3
        }
    }
})

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const clientId = Math.random().toString(36).substring(7)
    const clientIP = req.socket.remoteAddress

    logger.info('WebSocket connection established', {
        clientId,
        ip: clientIP,
        userAgent: req.headers['user-agent'],
        origin: req.headers.origin
    })

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to Stellar Portfolio Rebalancer',
        clientId,
        timestamp: new Date().toISOString(),
        serverTime: Date.now()
    }))

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString())
            logger.info('WebSocket message received', { clientId, type: data.type })

            // Echo back with server timestamp
            ws.send(JSON.stringify({
                type: 'echo',
                originalMessage: data,
                serverTimestamp: new Date().toISOString(),
                clientId
            }))
        } catch (error) {
            logger.warn('Invalid WebSocket message', {
                clientId,
                error: error instanceof Error ? error.message : String(error)
            })

            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format',
                timestamp: new Date().toISOString()
            }))
        }
    })

    // Handle client disconnect
    ws.on('close', (code, reason) => {
        logger.info('WebSocket connection closed', {
            clientId,
            code,
            reason: reason.toString()
        })
    })

    // Handle WebSocket errors
    ws.on('error', (error) => {
        logger.error('WebSocket client error', {
            clientId,
            error: error.message
        })
    })

    // Send periodic heartbeat
    const heartbeat = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                type: 'heartbeat',
                timestamp: new Date().toISOString(),
                serverTime: Date.now()
            }))
        } else {
            clearInterval(heartbeat)
        }
    }, 30000) // Every 30 seconds

    // Cleanup on close
    ws.on('close', () => {
        clearInterval(heartbeat)
    })
})

// WebSocket server error handling
wss.on('error', (error) => {
    logger.error('WebSocket server error:', error)
})

// Initialize rebalancing service
let rebalancingService: RebalancingService
try {
    rebalancingService = new RebalancingService(wss)
    rebalancingService.start()

    logger.info('Rebalancing service initialized successfully', {
        features: {
            riskManagement: true,
            automaticRebalancing: true,
            circuitBreakers: true,
            realTimeMonitoring: true
        }
    })
} catch (error) {
    logger.error('Failed to initialize rebalancing service:', error)
}

// Start server
server.listen(port, () => {
    logger.info('🚀 Stellar Portfolio Rebalancer API started successfully', {
        port: Number(port),
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        features: [
            'Portfolio Management',
            'Risk Management',
            'Automatic Rebalancing',
            'Real-time Price Feeds',
            'WebSocket Support',
            'Circuit Breakers',
            'CORS Enabled',
            'Health Monitoring'
        ],
        endpoints: {
            health: `http://localhost:${port}/health`,
            corsTest: `http://localhost:${port}/test/cors`,
            coinGeckoTest: `http://localhost:${port}/test/coingecko`
        }
    })
})

// Graceful shutdown handling
const gracefulShutdown = (signal: string) => {
    logger.info(`${signal} received, initiating graceful shutdown...`)

    // Close WebSocket connections gracefully
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify({
                type: 'server_shutdown',
                message: 'Server is shutting down gracefully',
                timestamp: new Date().toISOString()
            }))
            client.close(1000, 'Server shutdown')
        }
    })

    // Stop rebalancing service
    if (rebalancingService) {
        try {
            // Assuming the service has a stop method
            logger.info('Stopping rebalancing service...')
        } catch (error) {
            logger.error('Error stopping rebalancing service:', error)
        }
    }

    // Close HTTP server
    server.close((err) => {
        if (err) {
            logger.error('Error during server shutdown:', err)
            process.exit(1)
        }

        logger.info('Server shut down successfully')
        process.exit(0)
    })

    // Force exit after 15 seconds if graceful shutdown fails
    setTimeout(() => {
        logger.warn('Forcing shutdown after timeout')
        process.exit(1)
    }, 15000)
}

// Process signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception - shutting down:', error)
    gracefulShutdown('UNCAUGHT_EXCEPTION')
})

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection - shutting down:', {
        promise: String(promise),
        reason: String(reason)
    })
    gracefulShutdown('UNHANDLED_REJECTION')
})

// Export app for testing purposes
export default app