import 'dotenv/config'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import { WebSocketServer } from 'ws'
import { validateStartupConfigOrThrow, buildStartupSummary, logStartupSubsystems } from './config/startupConfig.js'
import { logger } from './utils/logger.js'
import { apiErrorHandler } from './middleware/apiErrorHandler.js'
import { requestContextMiddleware } from './middleware/requestContext.js'
import { probeRedis } from './queue/connection.js'
import { getRateLimitStoreType } from './middleware/rateLimit.js'
import { initializeSentry, setupProcessErrorHandlers, captureException } from './observability/sentry.js'
import { formatStartupSelfTestReport, runStartupSelfTest } from './monitoring/startupSelfTest.js'
import { buildCorsOptions, enforceCorsOriginAllowlist } from './http/corsSecurity.js'
import spec from './openapi/spec.js'

const isStartupSelfTestRequested = (argv: string[] = process.argv): boolean => argv.includes('--startup-self-test')

export async function main(argv: string[] = process.argv): Promise<void> {
    if (isStartupSelfTestRequested(argv)) {
        const report = await runStartupSelfTest(process.env)
        const output = formatStartupSelfTestReport(report)
        if (report.ok) {
            console.log(output)
            process.exitCode = 0
        } else {
            console.error(output)
            process.exitCode = 1
        }
        return
    }

    const config = validateStartupConfigOrThrow()

    initializeSentry()
    setupProcessErrorHandlers()

    const redisAvailable = await probeRedis(config)
    const { mountApiRoutes, mountLegacyNonApiRedirects } = await import('./http/mountApiRoutes.js')
    const { initRobustWebSocket } = await import('./services/websocket.service.js')
    const { startQueueScheduler } = await import('./queue/scheduler.js')
    const { metricsMiddleware, getMetricsPayload, getMetricsContentType } = await import('./observability/metrics.js')
    const { buildReadinessReport } = await import('./monitoring/readiness.js')

    const app = express()

    const corsOptions: cors.CorsOptions = buildCorsOptions(config.corsOrigins)

    app.use(enforceCorsOriginAllowlist(config.corsOrigins))
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

    const isMetricsAllowed = (req: Request): boolean => {
        if (config.nodeEnv === 'development' || config.nodeEnv === 'test') return true
        const ip = req.ip ?? req.socket?.remoteAddress ?? ''
        const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost'
        if (isLocal) return true
        return config.metricsAllowlist.some((entry) => ip.includes(entry))
    }

    app.get('/metrics', async (req, res, next) => {
        if (!isMetricsAllowed(req)) {
            logger.warn('[METRICS] Blocked /metrics access from IP', { ip: req.ip })
            return res.status(403).json({ error: 'Forbidden', message: 'Metrics endpoint is restricted' })
        }

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

    app.get('/health', (_req: Request, res: Response) => {
        res.status(200).type('text/plain').send('ok')
    })

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

    const rateLimitStore = getRateLimitStoreType()
    logger.info('[STARTUP] Config fingerprint', buildStartupSummary(config, redisAvailable) as Record<string, unknown>)
    logStartupSubsystems(config, redisAvailable, rateLimitStore)

    server.listen(config.port, () => {
        logger.info('[SERVER] Listening on port ' + config.port)
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

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
    main().catch((err: unknown) => {
        console.error('[STARTUP] Fatal error:', String(err))
        process.exit(1)
    })
}
