import 'dotenv/config'
import { validateStartupConfigOrThrow, buildStartupSummary } from './config/startupConfig.js'
import { logger } from './utils/logger.js'
import { createApp } from './startup/appFactory.js'
import { createHttpServer } from './startup/httpServer.js'
import { startQueueSchedulerOnListen } from './startup/workers.js'

const config = validateStartupConfigOrThrow()
const app = createApp(config)
const server = createHttpServer(app)

server.listen(config.port, () => {
    logger.info('[SERVER] Listening', buildStartupSummary(config) as Record<string, unknown>)
    startQueueSchedulerOnListen()
})
