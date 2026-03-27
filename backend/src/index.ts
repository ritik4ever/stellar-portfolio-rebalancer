import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { validateStartupConfigOrThrow, buildStartupSummary } from './config/startupConfig.js'
import { logger } from './utils/logger.js'
import { v1Router } from './api/v1Router.js'
import { apiErrorHandler } from './middleware/apiErrorHandler.js'
import { requestContextMiddleware } from './middleware/requestContext.js'
import { legacyApiDeprecation } from './middleware/legacyApiDeprecation.js'
import { startQueueScheduler } from './queue/scheduler.js'

const config = validateStartupConfigOrThrow()

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
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.set('trust proxy', 1)

/** Plain-text liveness for load balancers, curl, and frontend clients using GET /health on the API host. */
app.get('/health', (_req, res) => {
    res.status(200).type('text/plain').send('ok')
})

app.use('/api/v1', v1Router)
app.use('/api', legacyApiDeprecation, v1Router)

app.use(apiErrorHandler)

app.listen(config.port, () => {
    logger.info('[SERVER] Listening', buildStartupSummary(config) as Record<string, unknown>)
    void startQueueScheduler().catch((err: unknown) => {
        logger.warn('[SERVER] Queue scheduler did not start', { error: String(err) })
    })
})
