import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { REDIS_URL, isRedisAvailable } from '../queue/connection.js'
import { logger } from '../utils/logger.js'
import { getRebalanceLockConfig } from '../config/rebalanceLockConfig.js'
import { getRedisClientOptions } from '../config/redisConnectionOptions.js'
import { recordLockContention, recordLockHoldDuration, type LockBackend } from '../observability/metrics.js'

/**
 * Owner-token scripts (review #1728, round 2).
 *
 * The lock value is a random owner token minted at acquire time. Release and
 * renew must be bound to that token: an unconditional DEL/PEXPIRE from a
 * holder whose lock already expired (slow GC pause, network stall, or a
 * Multi-AZ failover window) could delete or extend a *different* holder's
 * freshly acquired lock, breaking mutual exclusion. Both operations run as
 * atomic compare-and-act Lua scripts so the check and the mutation cannot
 * interleave with another client.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end`

const RENEW_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
    return 0
end`

/**
 * Service to manage concurrency locks for portfolio rebalancing.
 * Prevents multiple rebalancing instances (auto or manual) from running
 * simultaneously for the same portfolio.
 */
export class RebalanceLockService {
    private redis: Redis | null = null
    /** In-memory fallback locks: lockKey -> { owner token, expiry }. */
    private fallbackLocks: Map<string, { token: string; expiresAt: number }> = new Map()
    private fallbackHeartbeats: Map<string, number> = new Map()
    // #1399 — acquire timestamp per lock, used to record hold duration on release.
    private acquiredAt: Map<string, number> = new Map()
    /** Owner tokens for locks currently held by this process (both backends). */
    private ownerTokens: Map<string, string> = new Map()
    private isInitialized: boolean = false
    /** Single in-flight init promise shared by all concurrent callers. */
    private initPromise: Promise<void> | null = null
    private useRedis: boolean = false
    private static instance: RebalanceLockService | null = null

    private constructor() {}

    /**
     * Singleton instance accessor
     */
    public static getInstance(): RebalanceLockService {
        if (!RebalanceLockService.instance) {
            RebalanceLockService.instance = new RebalanceLockService()
        }
        return RebalanceLockService.instance
    }

    /**
     * Initializes the locking service, deciding whether to use Redis or fallback.
     *
     * Review #1728 (round 2): init is memoized in a shared promise and
     * `isInitialized` flips only after the probe resolves, so concurrent
     * callers cannot observe a half-initialized service (or create duplicate
     * Redis clients) while the availability probe is still in flight.
     */
    public async init(): Promise<void> {
        if (this.isInitialized) return
        this.initPromise ??= this.performInit()
        return this.initPromise
    }

    private async performInit(): Promise<void> {
        try {
            this.useRedis = await isRedisAvailable()

            if (this.useRedis) {
                // Options are failover-aware: during an ElastiCache Multi-AZ
                // failover the connection drops and commands fail, so the client
                // reconnects with bounded backoff instead of giving up.
                // autoResendUnfulfilledCommands is explicitly disabled (it is also
                // the shared default): replaying an in-flight DEL/PEXPIRE after a
                // reconnect could release or shrink a lock that another holder
                // re-acquired while this client was disconnected.
                this.redis = new Redis(REDIS_URL, getRedisClientOptions({
                    autoResendUnfulfilledCommands: false,
                }))

                this.redis.on('error', (err) => {
                    logger.error('[LOCK_SERVICE] Redis connection error', { error: err.message })
                })

                logger.info('[LOCK_SERVICE] Initialized with Redis distributed locking')
            } else {
                logger.warn('[LOCK_SERVICE] Redis not available, using in-memory fallback locking (single-node only)')
            }
        } catch (error) {
            this.redis = null
            this.useRedis = false
            logger.error('[LOCK_SERVICE] Initialization failed, using in-memory fallback locking', {
                error: error instanceof Error ? error.message : String(error),
            })
        }

        this.isInitialized = true
    }

    /**
     * Attempts to acquire a lock for the given portfolio.
     * @param portfolioId The ID of the portfolio to lock.
     * @param ttlMs Time-to-live for the lock in milliseconds (default: REBALANCE_LOCK_TTL_MS, 5 minutes)
     * @returns Boolean indicating if the lock was successfully acquired.
     */
    public async acquireLock(portfolioId: string, ttlMs: number = getRebalanceLockConfig().ttlMs): Promise<boolean> {
        if (!this.isInitialized) {
            await this.init()
        }

        const lockKey = this.getLockKey(portfolioId)

        if (this.useRedis && this.redis) {
            try {
                // Review #1728 (round 2): the lock value is a random owner
                // token (not a timestamp). releaseLock/renewLock only act
                // when the stored value still matches this token, so an
                // expired holder can never delete or extend the next
                // holder's lock.
                const token = randomUUID()
                const result = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX')

                const acquired = result === 'OK'
                if (acquired) {
                    this.ownerTokens.set(lockKey, token)
                    this.acquiredAt.set(lockKey, Date.now())
                } else {
                    // #1399 — the lock was already held by another caller.
                    recordLockContention('redis')
                }
                return acquired
            } catch (error) {
                logger.error(`[LOCK_SERVICE] Failed to acquire Redis lock for ${portfolioId}`, {
                    error: error instanceof Error ? error.message : String(error)
                })
                // Fallback to memory if Redis query fails unexpectedly to prevent deadlock
                return this.acquireMemoryLock(lockKey, ttlMs)
            }
        } else {
            return this.acquireMemoryLock(lockKey, ttlMs)
        }
    }

    /**
     * Releases a previously acquired lock for a portfolio.
     *
     * Review #1728 (round 2): token-gated. The Redis DEL only runs when the
     * stored lock value still equals the owner token this process minted at
     * acquire time (atomic compare-and-delete Lua), so a holder whose lock
     * already expired — and was re-acquired elsewhere — cannot delete the
     * new holder's lock. A release without a local token is a no-op on the
     * shared lock; {@link forceReleaseLock} remains the explicit,
     * heartbeat-gated escape hatch for locks whose holder is gone.
     *
     * @param portfolioId The ID of the portfolio.
     */
    public async releaseLock(portfolioId: string): Promise<void> {
        if (!this.isInitialized) return

        const lockKey = this.getLockKey(portfolioId)

        // #1399 — record how long this lock was held, backend-labeled so a
        // spike in memory-backed holds (no real cross-instance exclusion) is
        // distinguishable from expected Redis contention.
        const acquiredAt = this.acquiredAt.get(lockKey)
        if (acquiredAt !== undefined) {
            const backend: LockBackend = this.useRedis ? 'redis' : 'memory'
            recordLockHoldDuration(backend, (Date.now() - acquiredAt) / 1000)
            this.acquiredAt.delete(lockKey)
        }

        const token = this.ownerTokens.get(lockKey)
        if (!token) {
            // This process does not hold the lock — deleting blindly could
            // destroy another holder's lock.
            logger.warn(`[LOCK_SERVICE] releaseLock called for ${portfolioId} without an owner token — skipping lock deletion`)
        } else if (this.useRedis && this.redis) {
            try {
                const deleted = await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token)
                if (deleted === 0) {
                    logger.warn(`[LOCK_SERVICE] Lock for ${portfolioId} was not deleted: it expired or was re-acquired by another holder`)
                }
            } catch (error) {
                logger.error(`[LOCK_SERVICE] Failed to release Redis lock for ${portfolioId}`, {
                    error: error instanceof Error ? error.message : String(error)
                })
            }
        } else {
            const entry = this.fallbackLocks.get(lockKey)
            if (entry && entry.token === token) {
                this.fallbackLocks.delete(lockKey)
            }
        }

        // Always clean up local ownership state (and any memory copy left
        // over from a mid-operation Redis fallback) when we held the lock.
        this.ownerTokens.delete(lockKey)
        if (token) {
            this.fallbackLocks.delete(lockKey)
        }
    }

    /**
     * Checks if a portfolio is currently locked without attempting to acquire it.
     */
    public async isLocked(portfolioId: string): Promise<boolean> {
        if (!this.isInitialized) {
            await this.init()
        }

        const lockKey = this.getLockKey(portfolioId)

        if (this.useRedis && this.redis) {
            try {
                const exists = await this.redis.exists(lockKey)
                return exists === 1
            } catch (error) {
                logger.error(`[LOCK_SERVICE] Failed to check Redis lock for ${portfolioId}`, {
                    error: error instanceof Error ? error.message : String(error)
                })
                return this.isMemoryLocked(lockKey)
            }
        } else {
            return this.isMemoryLocked(lockKey)
        }
    }

    /**
     * Extends the TTL of an already-held lock (used to keep long-running
     * rebalances alive). No-op when the lock is not currently held by this
     * process.
     *
     * Review #1728 (round 2): token-gated compare-and-PEXPIRE. Without the
     * owner check, a stalled holder whose lock expired could extend the TTL
     * of a *different* holder's freshly acquired lock, silently lengthening
     * someone else's critical section.
     *
     * @param portfolioId The ID of the portfolio whose lock should be renewed.
     * @param ttlMs Renewed time-to-live in milliseconds (default: REBALANCE_LOCK_TTL_MS)
     * @returns Boolean indicating whether the lock was renewed.
     */
    public async renewLock(portfolioId: string, ttlMs: number = getRebalanceLockConfig().ttlMs): Promise<boolean> {
        if (!this.isInitialized) {
            await this.init()
        }

        const lockKey = this.getLockKey(portfolioId)

        if (this.useRedis && this.redis) {
            const token = this.ownerTokens.get(lockKey)
            if (!token) {
                logger.warn(`[LOCK_SERVICE] renewLock called for ${portfolioId} without an owner token — refusing to extend`)
                return false
            }
            try {
                const renewed = await this.redis.eval(RENEW_LOCK_SCRIPT, 1, lockKey, token, ttlMs.toString())
                if (renewed === 0) {
                    // Lock expired or was re-acquired by another holder; drop
                    // the stale local token so releaseLock cannot act on it.
                    this.ownerTokens.delete(lockKey)
                    logger.warn(`[LOCK_SERVICE] Lock for ${portfolioId} was not renewed: it expired or was re-acquired by another holder`)
                }
                return renewed === 1
            } catch (error) {
                logger.error(`[LOCK_SERVICE] Failed to renew Redis lock for ${portfolioId}`, {
                    error: error instanceof Error ? error.message : String(error)
                })
                return false
            }
        }

        return this.renewMemoryLock(lockKey, ttlMs)
    }

    /**
     * Cleanup and close Redis connection.
     */
    public async stop(): Promise<void> {
        if (this.redis) {
            await this.redis.quit()
            this.redis = null
        }
        this.isInitialized = false
        this.initPromise = null
        this.ownerTokens.clear()
    }

    private getLockKey(portfolioId: string): string {
        return `lock:rebalance:${portfolioId}`
    }

    private getHeartbeatKey(portfolioId: string): string {
        return `lock:heartbeat:${portfolioId}`
    }

    public async updateHeartbeat(portfolioId: string, timestamp: number = Date.now()): Promise<void> {
        if (!this.isInitialized) await this.init()
        const heartbeatKey = this.getHeartbeatKey(portfolioId)
        this.fallbackHeartbeats.set(heartbeatKey, timestamp)
        if (this.useRedis && this.redis) {
            try {
                await this.redis.set(heartbeatKey, timestamp.toString(), 'PX', 60000)
            } catch (error) {
                logger.error(`[LOCK_SERVICE] Failed to update Redis heartbeat for ${portfolioId}`, {
                    error: error instanceof Error ? error.message : String(error)
                })
            }
        }
    }

    public async getLastHeartbeat(portfolioId: string): Promise<number | null> {
        if (!this.isInitialized) await this.init()
        const heartbeatKey = this.getHeartbeatKey(portfolioId)
        if (this.useRedis && this.redis) {
            try {
                const val = await this.redis.get(heartbeatKey)
                if (val) return parseInt(val, 10)
            } catch {}
        }
        return this.fallbackHeartbeats.get(heartbeatKey) ?? null
    }

    /**
     * Forcibly releases a lock for a portfolio if it is stale or missing a recent heartbeat.
     * Rejects forced release if the lock holder is actively updating its heartbeat within maxStaleMs.
     */
    public async forceReleaseLock(
        portfolioId: string,
        maxStaleMs: number = 30000
    ): Promise<{ released: boolean; reason: string }> {
        if (!this.isInitialized) await this.init()

        const locked = await this.isLocked(portfolioId)
        if (!locked) {
            return { released: true, reason: 'NOT_LOCKED' }
        }

        const lastHeartbeat = await this.getLastHeartbeat(portfolioId)
        const now = Date.now()

        if (lastHeartbeat && (now - lastHeartbeat) < maxStaleMs) {
            logger.warn(`[LOCK_SERVICE] Force release rejected — lock for ${portfolioId} is active`, {
                portfolioId,
                lastHeartbeat,
                ageMs: now - lastHeartbeat,
                maxStaleMs
            })
            return { released: false, reason: 'LOCK_ACTIVE' }
        }

        // Review #1728 (round 2): force release is the deliberate escape
        // hatch for locks whose holder is gone — by definition this process
        // holds no owner token for them, so it bypasses the token-gated
        // releaseLock path. The heartbeat staleness check above is what
        // guards against deleting an active holder's lock.
        await this.deleteLockUnconditional(this.getLockKey(portfolioId))
        const heartbeatKey = this.getHeartbeatKey(portfolioId)
        this.fallbackHeartbeats.delete(heartbeatKey)
        if (this.useRedis && this.redis) {
            try { await this.redis.del(heartbeatKey) } catch {}
        }

        logger.info(`[LOCK_SERVICE] Force released lock for ${portfolioId}`, {
            portfolioId,
            lastHeartbeat,
            reason: 'STALE_LOCK_RELEASED'
        })

        return { released: true, reason: 'STALE_LOCK_RELEASED' }
    }

    /**
     * Unconditional lock deletion — used ONLY by {@link forceReleaseLock},
     * the operator escape hatch gated by the heartbeat staleness check.
     * The normal release path is token-gated (compare-and-delete Lua); this
     * one intentionally is not, and must never be called from it.
     */
    private async deleteLockUnconditional(lockKey: string): Promise<void> {
        if (this.useRedis && this.redis) {
            try {
                await this.redis.del(lockKey)
            } catch (error) {
                logger.error('[LOCK_SERVICE] Failed to force-delete Redis lock', {
                    lockKey,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }
        this.fallbackLocks.delete(lockKey)
        this.ownerTokens.delete(lockKey)
    }

    private acquireMemoryLock(lockKey: string, ttlMs: number): boolean {
        const now = Date.now()
        const existing = this.fallbackLocks.get(lockKey)

        if (existing && existing.expiresAt > now) {
            // #1399 — the lock is currently held and active.
            recordLockContention('memory')
            return false
        }

        // Lock is either not held or expired. Mint an owner token so the
        // memory path enforces the same owner binding as the Redis path
        // (release/renew only act on a matching token).
        const token = randomUUID()
        this.fallbackLocks.set(lockKey, { token, expiresAt: now + ttlMs })
        this.ownerTokens.set(lockKey, token)
        this.acquiredAt.set(lockKey, now)
        return true
    }

    private isMemoryLocked(lockKey: string): boolean {
        const entry = this.fallbackLocks.get(lockKey)
        return !!entry && entry.expiresAt > Date.now()
    }

    private renewMemoryLock(lockKey: string, ttlMs: number): boolean {
        const entry = this.fallbackLocks.get(lockKey)
        if (!entry || entry.expiresAt <= Date.now()) {
            return false
        }
        entry.expiresAt = Date.now() + ttlMs
        return true
    }
}

// Export singleton instance
export const rebalanceLockService = RebalanceLockService.getInstance()
