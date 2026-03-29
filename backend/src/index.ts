import 'dotenv/config'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import { validateStartupConfigOrThrow, buildStartupSummary } from './config/startupConfig.js'
import { logger } from './utils/logger.js'
import { v1Router } from './api/v1Router.js'
import { apiErrorHandler } from './middleware/apiErrorHandler.js'
import { requestContextMiddleware } from './middleware/requestContext.js'
import { legacyApiDeprecation } from './middleware/legacyApiDeprecation.js'
import { startQueueScheduler } from './queue/scheduler.js'
import { initializeSentry, setupProcessErrorHandlers, captureException } from './observability/sentry.js'
import { metricsMiddleware, getMetricsPayload, getMetricsContentType } from './observability/metrics.js'
import spec from './openapi/spec.js'

const config = validateStartupConfigOrThrow()
initializeSentry()
setupProcessErrorHandlers()

const app = express()

const corsOptions: cors.CorsOptions = {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With', 'X-Request-Id']
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(requestContextMiddleware)
app.use(metricsMiddleware)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.set('trust proxy', 1)

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
    logger.info('[SERVER] Listening', buildStartupSummary(config) as Record<string, unknown>)
    void startQueueScheduler().catch((err: unknown) => {
        logger.warn('[SERVER] Queue scheduler did not start', { error: String(err) })
        captureException(err, { subsystem: 'queue_scheduler' })
    })
})
