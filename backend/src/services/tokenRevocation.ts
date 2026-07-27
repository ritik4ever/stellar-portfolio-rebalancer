import Redis from 'ioredis'
import { REDIS_URL, isRedisAvailable } from '../queue/connection.js'
import { logger } from '../utils/logger.js'

const REVOKED_PREFIX = 'revoked_token:'
const REVOKED_USER_PREFIX = 'revoked_user:'
const REVOKED_USER_TTL_SEC = 7 * 24 * 60 * 60

class TokenRevocationService {
    private redis: Redis | null = null
    private fallbackSet: Set<string> = new Set()
    private fallbackUserSet: Set<string> = new Set()
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
                logger.error('[TOKEN_REVOCATION] Redis error', { error: err.message })
            })
            logger.info('[TOKEN_REVOCATION] Initialized with Redis')
        } else {
            logger.warn('[TOKEN_REVOCATION] Redis unavailable, using in-memory fallback')
        }
    }

    private async ensureInit(): Promise<void> {
        await this.init()
    }

    async addRevokedToken(tokenHash: string, ttlSeconds: number): Promise<void> {
        await this.ensureInit()
        if (this.useRedis && this.redis) {
            const key = `${REVOKED_PREFIX}${tokenHash}`
            await this.redis.set(key, '1', 'EX', Math.max(1, Math.ceil(ttlSeconds)))
                .catch((err) => logger.error('[TOKEN_REVOCATION] Failed to store revoked token', { error: err.message }))
        } else {
            this.fallbackSet.add(tokenHash)
        }
    }

    async isRevoked(tokenHash: string): Promise<boolean> {
        await this.ensureInit()
        if (this.useRedis && this.redis) {
            try {
                const exists = await this.redis.exists(`${REVOKED_PREFIX}${tokenHash}`)
                return exists === 1
            } catch {
                return this.fallbackSet.has(tokenHash)
            }
        }
        return this.fallbackSet.has(tokenHash)
    }

    async revokeAllForUser(userAddress: string): Promise<void> {
        await this.ensureInit()
        if (this.useRedis && this.redis) {
            const key = `${REVOKED_USER_PREFIX}${userAddress}`
            await this.redis.set(key, 'all', 'EX', REVOKED_USER_TTL_SEC)
                .catch((err) => logger.error('[TOKEN_REVOCATION] Failed to revoke user', { error: err.message }))
        } else {
            this.fallbackUserSet.add(userAddress)
        }
        logger.warn('[TOKEN_REVOCATION] All sessions revoked for user', { userAddress })
    }

    async isUserRevoked(userAddress: string): Promise<boolean> {
        await this.ensureInit()
        if (this.useRedis && this.redis) {
            try {
                const exists = await this.redis.exists(`${REVOKED_USER_PREFIX}${userAddress}`)
                return exists === 1
            } catch {
                return this.fallbackUserSet.has(userAddress)
            }
        }
        return this.fallbackUserSet.has(userAddress)
    }

    async deinit(): Promise<void> {
        if (this.redis) {
            await this.redis.quit().catch(() => {})
            this.redis = null
        }
        this.initialized = false
    }

    _resetForTest(): void {
        this.fallbackSet.clear()
        this.fallbackUserSet.clear()
        this.initialized = false
        this.useRedis = false
        this.redis = null
    }
}

export const tokenRevocationService = new TokenRevocationService()
