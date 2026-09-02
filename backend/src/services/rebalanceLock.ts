import Redis from 'ioredis'
import { REDIS_URL, isRedisAvailable } from '../queue/connection.js'
import { logger } from '../utils/logger.js'
import { getRebalanceLockConfig } from '../config/rebalanceLockConfig.js'
import { getRedisClientOptions } from '../config/redisConnectionOptions.js'
import { recordLockContention, recordLockHoldDuration, type LockBackend } from '../observability/metrics.js'

/**
 * Service to manage concurrency locks for portfolio rebalancing.
 * Prevents multiple rebalancing instances (auto or manual) from running
 * simultaneously for the same portfolio.
 */
export class RebalanceLockService {
    private redis: Redis | null = null
    private fallbackLocks: Map<string, number> = new Map()
    private fallbackHeartbeats: Map<string, number> = new Map()
    // #1399 — acquire timestamp per lock, used to record hold duration on release.
    private acquiredAt: Map<string, number> = new Map()
    private isInitialized: boolean = false
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
     */
    public async init(): Promise<void> {
        if (this.isInitialized) return

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
                const result = await this.redis.set(lockKey, Date.now().toString(), 'PX', ttlMs, 'NX')

                const acquired = result === 'OK'
                if (acquired) {
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

        if (this.useRedis && this.redis) {
            try {
                await this.redis.del(lockKey)
            } catch (error) {
                logger.error(`[LOCK_SERVICE] Failed to release Redis lock for ${portfolioId}`, {
                    error: error instanceof Error ? error.message : String(error)
                })
            }
        }

        // Always clean up memory lock just in case
        this.fallbackLocks.delete(lockKey)
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
     * rebalances alive). No-op when the lock is not currently held.
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
            try {
                const renewed = await this.redis.pexpire(lockKey, ttlMs)
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

        await this.releaseLock(portfolioId)
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

    private acquireMemoryLock(lockKey: string, ttlMs: number): boolean {
        const now = Date.now()
        const existingExpiry = this.fallbackLocks.get(lockKey)

        if (existingExpiry && existingExpiry > now) {
            // #1399 — the lock is currently held and active.
            recordLockContention('memory')
            return false
        }

        // Lock is either not held or expired
        this.fallbackLocks.set(lockKey, now + ttlMs)
        this.acquiredAt.set(lockKey, now)
        return true
    }

    private isMemoryLocked(lockKey: string): boolean {
        const expiry = this.fallbackLocks.get(lockKey)
        return !!expiry && expiry > Date.now()
    }

    private renewMemoryLock(lockKey: string, ttlMs: number): boolean {
        if (!this.isMemoryLocked(lockKey)) {
            return false
        }
        this.fallbackLocks.set(lockKey, Date.now() + ttlMs)
        return true
    }
}

// Export singleton instance
export const rebalanceLockService = RebalanceLockService.getInstance()
