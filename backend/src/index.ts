import 'dotenv/config'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
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
import spec from './openapi/spec.js'

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

    app.get('/readiness', async (_req, res) => {
        const report = await buildReadinessReport()
        res.status(report.status === 'ready' ? 200 : 503).json(report)
    })

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

/** Serve the raw OpenAPI JSON at a stable URL (useful for Postman / CI) */
app.get('/api-docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.json(spec)
})

app.use(apiErrorHandler)

    app.listen(config.port, () => {
        const rateLimitStore = getRateLimitStoreType()
        logger.info('[SERVER] Listening', buildStartupSummary(config, redisAvailable) as Record<string, unknown>)
        logStartupSubsystems(config, redisAvailable, rateLimitStore)

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
