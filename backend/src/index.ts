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

// FIXED CORS Configuration with proper TypeScript types
const corsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Allow requests with no origin (mobile apps, etc.)
        if (!origin) return callback(null, true)

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

        // Check Vercel patterns
        if (origin.match(/^https:\/\/stellar-portfolio-rebalancer.*\.vercel\.app$/) ||
            origin.match(/^https:\/\/.*-ritik4evers-projects\.vercel\.app$/)) {
            return callback(null, true)
        }

        // Log rejected origins for debugging
        console.log('CORS rejected origin:', origin)
        callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'Origin',
        'X-Requested-With'
    ],
    optionsSuccessStatus: 200
}

app.use(cors(corsOptions))

// Explicit preflight handling
app.options('*', cors(corsOptions))

// Middleware
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, {
        userAgent: req.get('User-Agent'),
        origin: req.get('Origin'),
        ip: req.ip
    })
    next()
})

// API Routes - mount all routes under /api prefix
app.use('/api', portfolioRouter)

// Also mount some routes at root level for backward compatibility
app.use('/', portfolioRouter)

// Root route for health check
app.get('/', (req, res) => {
    res.json({
        message: 'Stellar Portfolio Rebalancer API',
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        origin: req.get('Origin'),
        features: {
            rebalancing: true,
            riskManagement: true,
            realTimePrices: true,
            webSockets: true
        }
    })
})

// Additional health endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development',
        origin: req.get('Origin')
    })
})

// CORS test endpoint
app.get('/test/cors', (req, res) => {
    res.json({
        success: true,
        message: 'CORS is working!',
        origin: req.get('Origin'),
        timestamp: new Date().toISOString(),
        headers: {
            origin: req.get('Origin'),
            userAgent: req.get('User-Agent')
        }
    })
})

// CoinGecko test endpoint
app.get('/test/coingecko', async (req, res) => {
    try {
        console.log('Testing CoinGecko API...')
        console.log('Environment variables:', {
            hasApiKey: !!process.env.COINGECKO_API_KEY,
            nodeEnv: process.env.NODE_ENV
        })

        // Import ReflectorService dynamically
        const { ReflectorService } = await import('./services/reflector.js')
        const reflector = new ReflectorService()

        // Clear cache to force fresh request
        reflector.clearCache()

        const prices = await reflector.getCurrentPrices()

        res.json({
            success: true,
            apiKey: !!process.env.COINGECKO_API_KEY,
            environment: process.env.NODE_ENV,
            prices,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        console.error('CoinGecko test failed:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        res.status(500).json({
            success: false,
            error: errorMessage,
            apiKey: !!process.env.COINGECKO_API_KEY,
            environment: process.env.NODE_ENV
        })
    }
})

// Error handling middleware (must be last)
app.use(notFound)
app.use(errorHandler)

// Create HTTP server
const server = createServer(app)

// Create WebSocket server
const wss = new WebSocketServer({
    server,
    clientTracking: true,
    maxPayload: 16 * 1024 * 1024 // 16MB
})

// WebSocket connection handling with enhanced features
wss.on('connection', (ws, req) => {
    const clientId = Math.random().toString(36).substring(7)

    logger.info('New WebSocket connection established', {
        clientId,
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
    })

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to Stellar Portfolio Rebalancer',
        clientId,
        timestamp: new Date().toISOString()
    }))

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString())
            logger.info('Received WebSocket message:', { clientId, data })

            // Echo back for now - can add specific handlers later
            ws.send(JSON.stringify({
                type: 'echo',
                originalMessage: data,
                timestamp: new Date().toISOString()
            }))
        } catch (error) {
            logger.warn('Invalid WebSocket message format:', { clientId, message: message.toString() })
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

    // Handle errors
    ws.on('error', (error) => {
        logger.error('WebSocket error:', { clientId, error: error.message })
    })

    // Send periodic heartbeat
    const heartbeat = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                type: 'heartbeat',
                timestamp: new Date().toISOString()
            }))
        } else {
            clearInterval(heartbeat)
        }
    }, 30000) // Every 30 seconds
})

// WebSocket server error handling
wss.on('error', (error) => {
    logger.error('WebSocket server error:', error)
})

// Start enhanced rebalancing service
const rebalancingService = new RebalancingService(wss)
rebalancingService.start()

logger.info('Enhanced Rebalancing Service initialized with:', {
    riskManagement: true,
    automaticRebalancing: true,
    circuitBreakers: true,
    realTimeMonitoring: true
})

// Start server
server.listen(port, () => {
    logger.info(`🚀 Stellar Portfolio Rebalancer API started`, {
        port,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        features: [
            'Portfolio Management',
            'Risk Management',
            'Automatic Rebalancing',
            'Real-time Price Feeds',
            'WebSocket Support',
            'Circuit Breakers'
        ]
    })
})

// Enhanced graceful shutdown
const gracefulShutdown = (signal: string) => {
    logger.info(`${signal} received, starting graceful shutdown...`)

    // Close WebSocket connections
    wss.clients.forEach(client => {
        client.send(JSON.stringify({
            type: 'server_shutdown',
            message: 'Server is shutting down',
            timestamp: new Date().toISOString()
        }))
        client.close()
    })

    // Close HTTP server
    server.close((err) => {
        if (err) {
            logger.error('Error during server shutdown:', err)
            process.exit(1)
        }

        logger.info('Server shut down successfully')
        process.exit(0)
    })

    // Force exit after 10 seconds
    setTimeout(() => {
        logger.warn('Forced shutdown after timeout')
        process.exit(1)
    }, 10000)
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error)
    gracefulShutdown('UNCAUGHT_EXCEPTION')
})

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', { promise: String(promise), reason: String(reason) })
    gracefulShutdown('UNHANDLED_REJECTION')
})