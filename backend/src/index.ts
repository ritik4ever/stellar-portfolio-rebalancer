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

// SIMPLIFIED CORS - ALLOW ALL (for now)
app.use(cors({
    origin: true, // Allow all origins
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
}))

// Handle preflight requests
app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With')
    res.status(200).end()
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

// CRITICAL: Test endpoints FIRST (before other routes)
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    })
})

app.get('/test/cors', (req, res) => {
    res.json({
        success: true,
        message: 'CORS working!',
        origin: req.get('Origin'),
        timestamp: new Date().toISOString()
    })
})

app.get('/test/coingecko', async (req, res) => {
    try {
        console.log('Testing CoinGecko API...')
        const { ReflectorService } = await import('./services/reflector.js')
        const reflector = new ReflectorService()
        reflector.clearCache()
        const prices = await reflector.getCurrentPrices()

        res.json({
            success: true,
            prices,
            hasApiKey: !!process.env.COINGECKO_API_KEY,
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
        timestamp: new Date().toISOString()
    })
})

// MOUNT API ROUTES
app.use('/api', portfolioRouter)

// DUPLICATE ROUTES AT ROOT FOR COMPATIBILITY
app.use('/', portfolioRouter)

// 404 handler
app.use((req, res) => {
    console.log(`404 - Route not found: ${req.method} ${req.url}`)
    res.status(404).json({
        error: 'Route not found',
        method: req.method,
        url: req.url,
        timestamp: new Date().toISOString()
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

// WebSocket (simplified)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
    console.log('WebSocket connection established')
    ws.send(JSON.stringify({ type: 'connection', message: 'Connected' }))

    ws.on('error', (error) => {
        console.error('WebSocket error:', error)
    })
})

// Start rebalancing service (with error handling)
try {
    const rebalancingService = new RebalancingService(wss)
    rebalancingService.start()
    console.log('Rebalancing service started')
} catch (error) {
    console.error('Failed to start rebalancing service:', error)
}

// Start server
server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`CoinGecko API Key: ${!!process.env.COINGECKO_API_KEY ? 'SET' : 'NOT SET'}`)
    console.log('Test endpoints:')
    console.log(`  Health: http://localhost:${port}/health`)
    console.log(`  CORS: http://localhost:${port}/test/cors`)
    console.log(`  CoinGecko: http://localhost:${port}/test/coingecko`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully')
    server.close(() => {
        process.exit(0)
    })
})

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully')
    server.close(() => {
        process.exit(0)
    })
})

export default app