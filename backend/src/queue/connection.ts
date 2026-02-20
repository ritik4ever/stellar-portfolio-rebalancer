import { logger } from '../utils/logger.js'

// BullMQ bundles its own ioredis internally.
// We pass the REDIS_URL string to BullMQ connection options directly.
// This avoids the type conflict between the standalone ioredis package
// and BullMQ's bundled ioredis.

export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

/**
 * Returns the shared BullMQ-compatible connection options.
 * Pass this to every Queue and Worker constructor.
 */
export function getConnectionOptions() {
    return {
        url: REDIS_URL,
        maxRetriesPerRequest: null, // required by BullMQ
        enableReadyCheck: false,
        lazyConnect: false,
    }
}

/**
 * Checks whether Redis is reachable by doing a lightweight TCP connect + PING.
 * Uses the standalone ioredis only for this probe (not passed into BullMQ).
 */
export async function isRedisAvailable(): Promise<boolean> {
    try {
        // Dynamic import so the module loads even if ioredis isn't installed
        const { default: IORedis } = await import('ioredis')
        const probe = new IORedis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            enableReadyCheck: false,
        })
        await probe.connect()
        await probe.ping()
        await probe.quit()
        return true
    } catch {
        return false
    }
}

/**
 * Logs a startup banner for the queue subsystem.
 */
export function logQueueStartup(redisAvailable: boolean) {
    if (redisAvailable) {
        logger.info('[QUEUE] Redis available – BullMQ workers and scheduler enabled', {
            redisUrl: REDIS_URL.replace(/:\/\/[^@]*@/, '://***@'), // mask auth
        })
    } else {
        logger.warn('[QUEUE] Redis unavailable – falling back to no-op (jobs will not be queued). Set REDIS_URL to enable queue-backed scheduling.')
    }
}
