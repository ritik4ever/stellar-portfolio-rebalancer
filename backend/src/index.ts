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

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// API Routes - this is the key fix
app.use('/api', portfolioRouter)

// Root route for health check
app.get('/', (req, res) => {
    res.json({
        message: 'Stellar Portfolio Rebalancer API',
        status: 'running',
        timestamp: new Date().toISOString()
    })
})

// Error handling middleware
app.use(notFound)
app.use(errorHandler)

// Create HTTP server
const server = createServer(app)

// Create WebSocket server
const wss = new WebSocketServer({ server })

// WebSocket connection handling
wss.on('connection', (ws) => {
    logger.info('New WebSocket connection established')

    ws.on('message', (message) => {
        logger.info('Received WebSocket message:', message.toString())
    })

    ws.on('close', () => {
        logger.info('WebSocket connection closed')
    })
})

// Start rebalancing service
const rebalancingService = new RebalancingService(wss)
rebalancingService.start()

// Start server
server.listen(port, () => {
    logger.info(`Server running on port ${port}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully')
    server.close(() => {
        logger.info('Process terminated')
    })
})