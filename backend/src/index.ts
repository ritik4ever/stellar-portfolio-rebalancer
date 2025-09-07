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

// Enhanced CORS configuration
app.use(cors({
    origin: [
        'http://localhost:3000',  // Local frontend
        'http://localhost:5173',  // Vite dev server
        'https://your-vercel-app.vercel.app'  // Replace with your actual Vercel URL
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}))

// Middleware
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, {
        userAgent: req.get('User-Agent'),
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
        environment: process.env.NODE_ENV || 'development'
    })
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