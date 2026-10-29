import Redis from 'ioredis'
import { REDIS_URL, isRedisAvailable } from '../queue/connection.js'
import { logger } from '../utils/logger.js'
import { getRedisClientOptions } from '../config/redisConnectionOptions.js'

const DLQ_KEY = 'dead_letter:webhook'
/** Tracks which deliveries already have a dead-letter entry (SPR-2026-173). */
const DLQ_DEDUPE_KEY = 'dead_letter:webhook:delivery_ids'

// #1207 seed-then-replay integration coverage: replay() re-delivers the original
// payload and drops the entry on success, or bumps attemptsExhausted on repeat failure.

export interface DeadLetterItem {
    id: string
    payload: unknown
    errorMessage: string
    /**
     * Attempts actually made for this delivery. Equal to the configured max
     * attempts when the retry budget was exhausted, lower when the retry loop
     * stopped early (for example when the caller aborted the delivery).
     */
    attemptsExhausted: number
    timestamp: string
    webhookUrl: string
    userId: string
    eventType: string
    /**
     * Stable idempotency id of the delivery, also sent to the endpoint as
     * `X-Webhook-Delivery-Id`. Correlates this entry with the delivery rows in
     * `notification_logs` and lets a replay be recognised by the receiver.
     * At most one dead-letter entry exists per deliveryId.
     */
    deliveryId?: string
    /** True when the retry loop stopped before using the full attempt budget. */
    stoppedEarly?: boolean
}

class WebhookDeadLetterQueue {
    private redis: Redis | null = null
    private fallbackList: DeadLetterItem[] = []
    /** Delivery ids already present in the fallback list (dedupe mirror). */
    private fallbackDeliveryIds = new Set<string>()
    private useRedis = false
    private initialized = false
    /** Single in-flight init promise shared by all concurrent callers. */
    private initPromise: Promise<void> | null = null

    /**
     * Initializes the dead-letter store: Redis with the shared failover-aware
     * options (command replay explicitly disabled so a buffered RPUSH is never
     * resent after a failover) when available, otherwise an in-memory list.
     *
     * Review #1728 (round 2): `initialized` used to flip to true *before* the
     * async Redis probe completed. A concurrent `push()` during that window
     * wrote only to the in-memory fallback list while every later read went
     * to Redis — silently losing the dead-letter item. Init is now memoized
     * in a shared promise and `initialized` is set only after the probe
     * resolves.
     */
    async init(): Promise<void> {
        if (this.initialized) return
        this.initPromise ??= this.performInit()
        return this.initPromise
    }

    private async performInit(): Promise<void> {
        try {
            this.useRedis = await isRedisAvailable()

            if (this.useRedis) {
                // autoResendUnfulfilledCommands is explicitly disabled (also the
                // shared default): push() issues RPUSH, and replaying a buffered
                // RPUSH after a failover would enqueue the same dead-letter item
                // twice.
                this.redis = new Redis(REDIS_URL, getRedisClientOptions({
                    autoResendUnfulfilledCommands: false,
                }))
                this.redis.on('error', (err) => {
                    logger.error('[DLQ] Redis error', { error: err.message })
                })
                logger.info('[DLQ] Initialized with Redis')
            } else {
                logger.warn('[DLQ] Redis unavailable, using in-memory fallback')
            }
        } catch (err) {
            this.redis = null
            this.useRedis = false
            logger.error('[DLQ] Initialization failed, using in-memory fallback', {
                error: err instanceof Error ? err.message : String(err),
            })
        }

        this.initialized = true
    }

    /**
     * Enqueue a dead-letter entry.
     *
     * Entries are deduplicated per `deliveryId`: concurrent or repeated work for
     * the same delivery (a deduplicated waiter that saw the same failure, an
     * operator-triggered retry, ...) must not produce several replayable copies
     * of one notification. Returns `true` when the item was enqueued.
     *
     * `requeue()` opts out of the check because it re-adds an entry that this
     * queue itself just released for a replay.
     */
    async push(item: DeadLetterItem): Promise<boolean> {
        return this.enqueue(item, { dedupe: true })
    }

    private async enqueue(item: DeadLetterItem, options: { dedupe: boolean }): Promise<boolean> {
        if (!this.initialized) await this.init()

        if (options.dedupe && item.deliveryId) {
            const reserved = await this.reserveDeliveryId(item.deliveryId)
            if (!reserved) {
                logger.info('[DLQ] Delivery already dead-lettered; skipping duplicate entry', {
                    userId: item.userId,
                    eventType: item.eventType,
                    deliveryId: item.deliveryId,
                })
                return false
            }
        } else if (item.deliveryId) {
            await this.markDeliveryId(item.deliveryId)
        }

        const serialized = JSON.stringify(item)
        if (this.useRedis && this.redis) {
            await this.redis.rpush(DLQ_KEY, serialized)
                .catch((err) => {
                    logger.error('[DLQ] Failed to push to Redis', { error: err.message })
                    this.fallbackList.push(item)
                    if (item.deliveryId) this.fallbackDeliveryIds.add(item.deliveryId)
                })
        } else {
            this.fallbackList.push(item)
            if (item.deliveryId) this.fallbackDeliveryIds.add(item.deliveryId)
        }
        logger.warn('[DLQ] Webhook delivery moved to dead-letter queue', {
            userId: item.userId,
            eventType: item.eventType,
            attempts: item.attemptsExhausted,
            deliveryId: item.deliveryId,
            stoppedEarly: item.stoppedEarly,
        })
        return true
    }

    /**
     * Atomically claim the dead-letter slot for a delivery id.
     * Redis `SADD` returns 0 when the member already exists, so two concurrent
     * failures cannot both enqueue an entry for the same delivery.
     */
    private async reserveDeliveryId(deliveryId: string): Promise<boolean> {
        if (this.useRedis && this.redis) {
            try {
                const added = await this.redis.sadd(DLQ_DEDUPE_KEY, deliveryId)
                return Number(added) > 0
            } catch (err) {
                logger.error('[DLQ] Delivery id reservation failed; falling back to list scan', {
                    error: err instanceof Error ? err.message : String(err),
                })
                const items = await this.list()
                return !items.some((existing) => existing.deliveryId === deliveryId)
            }
        }

        if (this.fallbackDeliveryIds.has(deliveryId)) return false
        this.fallbackDeliveryIds.add(deliveryId)
        return true
    }

    /** Re-register a delivery id without the "already present" check. */
    private async markDeliveryId(deliveryId: string): Promise<void> {
        if (this.useRedis && this.redis) {
            await this.redis.sadd(DLQ_DEDUPE_KEY, deliveryId).catch((err: Error) => {
                logger.error('[DLQ] Failed to record delivery id', { error: err.message })
            })
            return
        }
        this.fallbackDeliveryIds.add(deliveryId)
    }

    /** Release the dedupe slot once an entry leaves the queue. */
    private async releaseDeliveryId(deliveryId: string | undefined): Promise<void> {
        if (!deliveryId) return

        if (this.useRedis && this.redis) {
            await this.redis.srem(DLQ_DEDUPE_KEY, deliveryId).catch((err: Error) => {
                logger.error('[DLQ] Failed to release delivery id', { error: err.message })
            })
            return
        }
        this.fallbackDeliveryIds.delete(deliveryId)
    }

    /**
     * Re-queue a previously replayed item after delivery failed again.
     * Persists the incremented attempt count so operators can see how many
     * times the payload has been replayed while sitting in the dead-letter.
     * The entry keeps its `deliveryId`, so the persisted record still points at
     * the same delivery as the `notification_logs` rows, and any entry already
     * queued for that delivery is replaced so the queue never holds two
     * replayable copies of one notification.
     */
    async requeue(item: DeadLetterItem): Promise<void> {
        const requeued = {
            ...item,
            attemptsExhausted: item.attemptsExhausted + 1,
        }

        if (requeued.deliveryId) {
            await this.removeByDeliveryId(requeued.deliveryId)
        }

        await this.enqueue(requeued, { dedupe: false })
        logger.warn('[DLQ] Failed replay re-queued with incremented attempts', {
            itemId: item.id,
            userId: item.userId,
            eventType: item.eventType,
            attempts: requeued.attemptsExhausted,
            deliveryId: item.deliveryId,
        })
    }

    /** Drop any queued entry for a delivery id (used by `requeue`). */
    private async removeByDeliveryId(deliveryId: string): Promise<void> {
        if (this.useRedis && this.redis) {
            const items = await this.redis.lrange(DLQ_KEY, 0, -1).catch(() => null)
            if (!items) return
            for (const raw of items) {
                const parsed = JSON.parse(raw) as DeadLetterItem
                if (parsed.deliveryId === deliveryId) {
                    await this.redis.lrem(DLQ_KEY, 1, raw)
                }
            }
            return
        }

        this.fallbackList = this.fallbackList.filter((entry) => entry.deliveryId !== deliveryId)
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
                    await this.releaseDeliveryId(parsed.deliveryId)
                    logger.info('[DLQ] Replayed item removed from queue', { itemId, deliveryId: parsed.deliveryId })
                    return parsed
                }
            }
        } else {
            const idx = this.fallbackList.findIndex((i) => i.id === itemId)
            if (idx !== -1) {
                const [item] = this.fallbackList.splice(idx, 1)
                await this.releaseDeliveryId(item.deliveryId)
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
                    await this.releaseDeliveryId(parsed.deliveryId)
                    return true
                }
            }
            return false
        }

        const idx = this.fallbackList.findIndex((i) => i.id === itemId)
        if (idx === -1) return false
        const [removed] = this.fallbackList.splice(idx, 1)
        await this.releaseDeliveryId(removed.deliveryId)
        return true
    }
}

export const webhookDeadLetter = new WebhookDeadLetterQueue()
