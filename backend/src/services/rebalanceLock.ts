import Redis from 'ioredis'
import { REDIS_URL, isRedisAvailable } from '../queue/connection.js'
import { logger } from '../utils/logger.js'

/**
 * Service to manage concurrency locks for portfolio rebalancing.
 * Prevents multiple rebalancing instances (auto or manual) from running
 * simultaneously for the same portfolio.
 */
export class RebalanceLockService {
    private redis: Redis | null = null
    private fallbackLocks: Map<string, number> = new Map()
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
            this.redis = new Redis(REDIS_URL, {
                lazyConnect: false,
                maxRetriesPerRequest: 3,
            })
            
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
     * @param ttlMs Time-to-live for the lock in milliseconds (default: 5 minutes)
     * @returns Boolean indicating if the lock was successfully acquired.
     */
    public async acquireLock(portfolioId: string, ttlMs: number = 5 * 60 * 1000): Promise<boolean> {
        if (!this.isInitialized) {
            await this.init()
        }

        const lockKey = this.getLockKey(portfolioId)

        if (this.useRedis && this.redis) {
            try {

                return result === 'OK'
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

    private acquireMemoryLock(lockKey: string, ttlMs: number): boolean {
        const now = Date.now()
        const existingExpiry = this.fallbackLocks.get(lockKey)

        if (existingExpiry && existingExpiry > now) {
            return false // Lock is currently held and active
        }

        // Lock is either not held or expired
        this.fallbackLocks.set(lockKey, now + ttlMs)
        return true
    }

    private isMemoryLocked(lockKey: string): boolean {
        const expiry = this.fallbackLocks.get(lockKey)
        return !!expiry && expiry > Date.now()
    }
}

// Export singleton instance
export const rebalanceLockService = RebalanceLockService.getInstance()
