import 'dotenv/config'
import { createServer } from 'node:http'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import { WebSocketServer } from 'ws'
import { validateStartupConfigOrThrow, buildStartupSummary, logStartupSubsystems } from './config/startupConfig.js'
import { logger } from './utils/logger.js'
import { v1Router } from './api/v1Router.js'
import { apiErrorHandler } from './middleware/apiErrorHandler.js'
import { requestContextMiddleware } from './middleware/requestContext.js'
import { legacyApiDeprecation } from './middleware/legacyApiDeprecation.js'
import { startQueueScheduler } from './queue/scheduler.js'
import { probeRedis } from './queue/connection.js'
import { getRateLimitStoreType } from './middleware/rateLimit.js'
import { initializeSentry, setupProcessErrorHandlers, captureException } from './observability/sentry.js'
import { metricsMiddleware, getMetricsPayload, getMetricsContentType } from './observability/metrics.js'
import { buildReadinessReport } from './monitoring/readiness.js'
import { mountApiRoutes, mountLegacyNonApiRedirects } from './http/mountApiRoutes.js'
import spec from './openapi/spec.js'
import { initRobustWebSocket } from './services/websocket.service.js'

async function main() {
    const config = validateStartupConfigOrThrow()
    initializeSentry()
    setupProcessErrorHandlers()

    const redisAvailable = await probeRedis()

    const app = express()

    const corsOptions: cors.CorsOptions = {
        origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'Accept',
            'Origin',
            'X-Requested-With',
            'X-Request-Id',
        ],
    }

    app.use(cors(corsOptions))
    app.options('*', cors(corsOptions))
    app.use(requestContextMiddleware)
    app.use(metricsMiddleware)
    app.use(express.json({ limit: '10mb' }))
    app.use(express.urlencoded({ extended: true, limit: '10mb' }))
    app.set('trust proxy', 1)

    const sendReadiness = async (_req: Request, res: Response) => {
        const report = await buildReadinessReport()
        res.status(report.status === 'ready' ? 200 : 503).json(report)
    }
    app.get('/readiness', sendReadiness)
    app.get('/ready', sendReadiness)

    app.get('/metrics', async (_req, res, next) => {
        try {
            res.setHeader('Content-Type', getMetricsContentType())
            res.status(200).send(await getMetricsPayload())
        } catch (error) {
            captureException(error, { route: '/metrics' })
            next(error)
        }
    })

    mountApiRoutes(app)
    mountLegacyNonApiRedirects(app)

    app.use(apiErrorHandler)
/** Plain-text liveness for load balancers */
app.get('/health', (_req: Request, res: Response) => {
    res.status(200).type('text/plain').send('ok')
})

/** Interactive API docs — served from the canonical spec.ts source of truth */
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec as Record<string, unknown>))

const serveOpenApiJson = (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.json(spec)
}

app.get('/api-docs.json', serveOpenApiJson)
app.get('/api-docs/openapi.json', serveOpenApiJson)

app.use(apiErrorHandler)

    const server = createServer(app)
    const wss = new WebSocketServer({ server })
    initRobustWebSocket(wss)

    server.listen(config.port, () => {
        const rateLimitStore = getRateLimitStoreType()
        logger.info('[SERVER] Listening', buildStartupSummary(config, redisAvailable) as Record<string, unknown>)
        logStartupSubsystems(config, redisAvailable, rateLimitStore)
        logger.info('[SERVER] WebSocket robust mode active (heartbeat, protocol validation, inactive cleanup)')

        if (redisAvailable) {
            void startQueueScheduler().catch((err: unknown) => {
                logger.warn('[SERVER] Queue scheduler did not start', { error: String(err) })
                captureException(err, { subsystem: 'queue_scheduler' })
            })
        } else {
            logger.warn('[SERVER] Queue scheduler skipped — Redis unavailable')
        }
    })
}

main().catch((err: unknown) => {
    console.error('[STARTUP] Fatal error:', String(err))
    process.exit(1)
})
