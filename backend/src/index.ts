import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import dotenv from 'dotenv'
import { portfolioRouter } from './api/routes.js'
import { RebalancingService } from './monitoring/rebalancer.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { logger } from './utils/logger.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Routes
app.use('/api', portfolioRouter)

// Error handling
app.use(notFound)
app.use(errorHandler)

const server = createServer(app)

// WebSocket for real-time updates
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
    logger.info('Client connected')

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString())
            if (data.type === 'subscribe') {
                logger.info('Client subscribed to portfolio updates')
            }
        } catch (error) {
            logger.error('Invalid WebSocket message', { error })
        }
    })

    ws.on('close', () => {
        logger.info('Client disconnected')
    })
})

server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`)
})

// Start rebalancing monitoring service
const rebalancer = new RebalancingService(wss)
rebalancer.start()

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully')
    server.close(() => {
        logger.info('Process terminated')
    })
})

export { wss }