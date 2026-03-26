import { startQueueScheduler } from '../queue/scheduler.js'
import { logger } from '../utils/logger.js'

export function startQueueSchedulerOnListen(): void {
    void startQueueScheduler().catch((err: unknown) => {
        logger.warn('[SERVER] Queue scheduler did not start', { error: String(err) })
    })
}
