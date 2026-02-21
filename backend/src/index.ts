
import { validateStartupConfigOrThrow, buildStartupSummary, type StartupConfig } from './config/startupConfig.js'
import { getFeatureFlags, getPublicFeatureFlags } from './config/featureFlags.js'
import { isRedisAvailable, logQueueStartup } from './queue/connection.js'
import { closeAllQueues } from './queue/queues.js'
import { startQueueScheduler } from './queue/scheduler.js'
import { startPortfolioCheckWorker, stopPortfolioCheckWorker } from './queue/workers/portfolioCheckWorker.js'
import { startRebalanceWorker, stopRebalanceWorker } from './queue/workers/rebalanceWorker.js'
import { startAnalyticsSnapshotWorker, stopAnalyticsSnapshotWorker } from './queue/workers/analyticsSnapshotWorker.js'

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


    try {
        await contractEventIndexerService.start()
    } catch (error) {
        console.error('[CHAIN-INDEXER] Failed to start:', error)
    }

    console.log('Available endpoints:')
    console.log(`  Health: http://localhost:${port}/health`)
    console.log(`  CORS Test: http://localhost:${port}/test/cors`)
    console.log(`  CoinGecko Test: http://localhost:${port}/test/coingecko`)
    console.log(`  Auto-Rebalancer Status: http://localhost:${port}/api/auto-rebalancer/status`)
    console.log(`  Queue Health: http://localhost:${port}/api/queue/health`)
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
        await contractEventIndexerService.stop()
        console.log('[SHUTDOWN] Contract event indexer stopped')
    } catch (error) {
        console.error('[SHUTDOWN] Error stopping contract event indexer:', error)
    }

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
