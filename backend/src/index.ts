import 'dotenv/config'
import { validateStartupConfigOrThrow, buildStartupSummary } from './config/startupConfig.js'
import { logger } from './utils/logger.js'
import { apiErrorHandler } from './middleware/apiErrorHandler.js'
import { mountApiRoutes, mountLegacyNonApiRedirects } from './http/mountApiRoutes.js'
import { requestContextMiddleware } from './middleware/requestContext.js'
import { startQueueScheduler } from './queue/scheduler.js'


/** Plain-text liveness for load balancers, curl, and frontend clients using GET /health on the API host. */
app.get('/health', (_req, res) => {
    res.status(200).type('text/plain').send('ok')
})

mountLegacyNonApiRedirects(app)
mountApiRoutes(app)

app.use(apiErrorHandler)
const config = validateStartupConfigOrThrow()
const app = createApp(config)
const server = createHttpServer(app)

server.listen(config.port, () => {
    logger.info('[SERVER] Listening', buildStartupSummary(config) as Record<string, unknown>)
    startQueueSchedulerOnListen()
})
