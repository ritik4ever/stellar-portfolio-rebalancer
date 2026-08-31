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

    /**
     * Re-queue a previously replayed item after delivery failed again.
     * Persists the incremented attempt count so operators can see how many
     * times the payload has been replayed while sitting in the dead-letter.
     */
    async requeue(item: DeadLetterItem): Promise<void> {
        await this.push({
            ...item,
            attemptsExhausted: item.attemptsExhausted + 1,
        })
        logger.warn('[DLQ] Failed replay re-queued with incremented attempts', {
            itemId: item.id,
            userId: item.userId,
            eventType: item.eventType,
            attempts: item.attemptsExhausted + 1,
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

// ── replay helpers (#1393) ───────────────────────────────────────────────────

/**
 * Filter + paginate the dead-letter queue. Keeps the admin listing usable once
 * a broken endpoint has produced thousands of entries.
 */
export interface DeadLetterQuery {
    userId?: string
    eventType?: string
    search?: string
    page?: number
    pageSize?: number
}

export interface DeadLetterListing {
    items: DeadLetterItem[]
    count: number
    summary: {
        total: number
        byEventType: Record<string, number>
        oldestTimestamp?: string
        newestTimestamp?: string
    }
    pagination: {
        page: number
        pageSize: number
        total: number
        totalPages: number
        hasMore: boolean
    }
}

const DEFAULT_DLQ_PAGE_SIZE = 50
const MAX_DLQ_PAGE_SIZE = 500

export function queryDeadLetterItems(
    all: DeadLetterItem[],
    query: DeadLetterQuery = {},
): DeadLetterListing {
    const search = query.search?.trim().toLowerCase()

    const filtered = all.filter((item) => {
        if (query.userId && item.userId !== query.userId) return false
        if (query.eventType && item.eventType !== query.eventType) return false
        if (search) {
            const haystack = `${item.id} ${item.userId} ${item.eventType} ${item.webhookUrl} ${item.errorMessage}`.toLowerCase()
            if (!haystack.includes(search)) return false
        }
        return true
    })

    const pageSize = clampPageSize(query.pageSize)
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1) || 1), totalPages)
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)

    const byEventType: Record<string, number> = {}
    for (const item of filtered) {
        byEventType[item.eventType] = (byEventType[item.eventType] ?? 0) + 1
    }

    const timestamps = filtered.map((i) => i.timestamp).filter(Boolean).sort()

    return {
        items,
        count: items.length,
        summary: {
            total: filtered.length,
            byEventType,
            oldestTimestamp: timestamps[0],
            newestTimestamp: timestamps[timestamps.length - 1],
        },
        pagination: {
            page,
            pageSize,
            total: filtered.length,
            totalPages,
            hasMore: start + items.length < filtered.length,
        },
    }
}

function clampPageSize(value: unknown): number {
    const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
    if (isNaN(parsed)) return DEFAULT_DLQ_PAGE_SIZE
    return Math.min(MAX_DLQ_PAGE_SIZE, Math.max(1, Math.trunc(parsed)))
}

/**
 * POST one dead-letter payload back to its webhook URL.
 *
 * Extracted so the single-item and batch replay endpoints share one definition
 * of what a replay *is* — previously the whole request/timeout closure was
 * duplicated between them and could drift apart.
 */
export async function postDeadLetterPayload(
    item: DeadLetterItem,
    timeoutMs: number,
): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetch(item.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Event': item.eventType,
                'X-Webhook-Replay': 'true',
            },
            body: JSON.stringify(item.payload),
            signal: controller.signal,
        })
        if (!response.ok) {
            throw new Error(`Webhook responded with status ${response.status}`)
        }
    } finally {
        clearTimeout(timeoutId)
    }
}
