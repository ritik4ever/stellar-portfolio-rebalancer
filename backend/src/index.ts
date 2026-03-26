import 'dotenv/config'
import { validateStartupConfigOrThrow, buildStartupSummary } from './config/startupConfig.js'
import { logger } from './utils/logger.js'


const config = validateStartupConfigOrThrow()
const app = createApp(config)
const server = createHttpServer(app)

server.listen(config.port, () => {
    logger.info('[SERVER] Listening', buildStartupSummary(config) as Record<string, unknown>)
    startQueueSchedulerOnListen()
})
