import Redis from 'ioredis'
import { REDIS_URL, isRedisAvailable } from '../queue/connection.js'
import { logger } from '../utils/logger.js'

const DLQ_KEY = 'dead_letter:webhook'

export interface DeadLetterItem {
    id: string
    payload: unknown
    errorMessage: string
    attemptsExhausted: number
    timestamp: string
    webhookUrl: string
    userId: string
    eventType: string
}

class WebhookDeadLetterQueue {
    private redis: Redis | null = null
    private fallbackList: DeadLetterItem[] = []
    private useRedis = false
    private initialized = false

    async init(): Promise<void> {
        if (this.initialized) return
        this.initialized = true

        this.useRedis = await isRedisAvailable()

        if (this.useRedis) {
            this.redis = new Redis(REDIS_URL, {
                lazyConnect: false,
                maxRetriesPerRequest: 3,
            })
            this.redis.on('error', (err) => {
                logger.error('[DLQ] Redis error', { error: err.message })
            })
            logger.info('[DLQ] Initialized with Redis')
        } else {
            logger.warn('[DLQ] Redis unavailable, using in-memory fallback')
        }
    }

    async push(item: DeadLetterItem): Promise<void> {
        if (!this.initialized) await this.init()

        const serialized = JSON.stringify(item)
        if (this.useRedis && this.redis) {
            await this.redis.rpush(DLQ_KEY, serialized)
                .catch((err) => {
                    logger.error('[DLQ] Failed to push to Redis', { error: err.message })
                    this.fallbackList.push(item)
                })
        } else {
            this.fallbackList.push(item)
        }
        logger.warn('[DLQ] Webhook delivery moved to dead-letter queue', {
            userId: item.userId,
            eventType: item.eventType,
            attempts: item.attemptsExhausted,
        })
    }

    async list(): Promise<DeadLetterItem[]> {
        if (!this.initialized) await this.init()

        if (this.useRedis && this.redis) {
            try {
                const items = await this.redis.lrange(DLQ_KEY, 0, -1)
                return items.map((i) => JSON.parse(i) as DeadLetterItem)
            } catch {
                return [...this.fallbackList]
            }
        }
        return [...this.fallbackList]
    }

    async replay(itemId: string): Promise<DeadLetterItem | null> {
        if (!this.initialized) await this.init()

        if (this.useRedis && this.redis) {
            const items = await this.redis.lrange(DLQ_KEY, 0, -1)
            for (let i = 0; i < items.length; i++) {
                const parsed = JSON.parse(items[i]) as DeadLetterItem
                if (parsed.id === itemId) {
                    await this.redis.lrem(DLQ_KEY, 1, items[i])
                    logger.info('[DLQ] Replayed item removed from queue', { itemId })
                    return parsed
                }
            }
        } else {
            const idx = this.fallbackList.findIndex((i) => i.id === itemId)
            if (idx !== -1) {
                const [item] = this.fallbackList.splice(idx, 1)
                return item
            }
        }
        return null
    }

    async delete(itemId: string): Promise<boolean> {
        if (!this.initialized) await this.init()

        if (this.useRedis && this.redis) {
            const items = await this.redis.lrange(DLQ_KEY, 0, -1)
            for (let i = 0; i < items.length; i++) {
                const parsed = JSON.parse(items[i]) as DeadLetterItem
                if (parsed.id === itemId) {
                    await this.redis.lrem(DLQ_KEY, 1, items[i])
                    return true
                }
            }
        } else {
            const idx = this.fallbackList.findIndex((i) => i.id === itemId)
            if (idx !== -1) {
                this.fallbackList.splice(idx, 1)
                return true
            }
        }
        return false
    }

    async deinit(): Promise<void> {
        if (this.redis) {
            await this.redis.quit().catch(() => {})
            this.redis = null
        }
        this.initialized = false
    }

    _resetForTest(): void {
        this.fallbackList = []
        this.initialized = false
        this.useRedis = false
        this.redis = null
    }
}

export const webhookDeadLetterQueue = new WebhookDeadLetterQueue()
