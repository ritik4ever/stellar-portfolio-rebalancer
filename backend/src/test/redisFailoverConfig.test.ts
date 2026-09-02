import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    buildRedisUrl,
    isRedisTlsEnabled,
    resolveRedisUrl,
    isRedisFailoverError,
    redisRetryStrategy,
    redisReconnectOnError,
    getRedisClientOptions,
    getBullMqConnectionOptions,
    getRedisProbeOptions,
    REDIS_RETRY_MAX_DELAY_MS,
} from '../config/redisConnectionOptions.js'

/**
 * Behaviour of the shared Redis connection settings used to survive an
 * ElastiCache Multi-AZ failover. See
 * deployment/terraform/modules/elasticache/README.md.
 */
describe('redisConnectionOptions', () => {
    describe('buildRedisUrl', () => {
        it('prefers an explicit REDIS_URL over REDIS_HOST', () => {
            const url = buildRedisUrl({
                url: 'redis://explicit.internal:6380',
                host: 'cluster.abc.clustercfg.use1.cache.amazonaws.com:6379',
            })
            expect(url).toBe('redis://explicit.internal:6380')
        })

        it('builds a URL from the replication-group endpoint host:port', () => {
            const url = buildRedisUrl({
                host: 'stellar-redis.abc.clustercfg.use1.cache.amazonaws.com:6379',
            })
            expect(url).toBe('redis://stellar-redis.abc.clustercfg.use1.cache.amazonaws.com:6379')
        })

        it('uses rediss:// when TLS (transit encryption) is enabled', () => {
            const url = buildRedisUrl({ host: 'primary.cache.amazonaws.com:6379', tls: true })
            expect(url).toBe('rediss://primary.cache.amazonaws.com:6379')
        })

        it('upgrades an http-style redis:// URL to rediss:// when TLS is enabled', () => {
            const url = buildRedisUrl({ url: 'redis://primary.cache.amazonaws.com:6379', tls: true })
            expect(url).toBe('rediss://primary.cache.amazonaws.com:6379')
        })

        it('leaves an existing rediss:// URL untouched when TLS is enabled', () => {
            const url = buildRedisUrl({ url: 'rediss://primary.cache.amazonaws.com:6379', tls: true })
            expect(url).toBe('rediss://primary.cache.amazonaws.com:6379')
        })

        it('injects the AUTH token when it is not already embedded', () => {
            const url = buildRedisUrl({
                host: 'primary.cache.amazonaws.com:6379',
                authToken: 'secret-redis-token-123',
            })
            expect(url).toBe('redis://:secret-redis-token-123@primary.cache.amazonaws.com:6379')
        })

        it('does not double-inject the AUTH token', () => {
            const url = buildRedisUrl({
                url: 'redis://:token@primary.cache.amazonaws.com:6379',
                authToken: 'another',
            })
            expect(url).toBe('redis://:token@primary.cache.amazonaws.com:6379')
        })

        it('percent-encodes special characters in the AUTH token', () => {
            const url = buildRedisUrl({ host: 'redis:6379', authToken: 'p@ss/w:rd' })
            expect(url).toBe('redis://:p%40ss%2Fw%3Ard@redis:6379')
        })

        it('falls back to localhost when neither url nor host is provided', () => {
            expect(buildRedisUrl()).toBe('redis://localhost:6379')
            expect(buildRedisUrl({ url: '  ', host: '  ' })).toBe('redis://localhost:6379')
        })
    })

    describe('resolveRedisUrl', () => {
        const saved = { ...process.env }

        afterEach(() => {
            process.env = { ...saved }
        })

        it('resolves the cluster endpoint from REDIS_HOST and honours REDIS_TLS', () => {
            delete process.env.REDIS_URL
            process.env.REDIS_HOST = 'primary.abc.clustercfg.use1.cache.amazonaws.com:6379'
            process.env.REDIS_TLS = 'true'
            delete process.env.REDIS_AUTH_TOKEN
            delete process.env.REDIS_PASSWORD

            expect(resolveRedisUrl()).toBe('rediss://primary.abc.clustercfg.use1.cache.amazonaws.com:6379')
        })

        it('prefers REDIS_URL when both are set', () => {
            process.env.REDIS_URL = 'redis://localhost:6379'
            process.env.REDIS_HOST = 'primary.abc.clustercfg.use1.cache.amazonaws.com:6379'
            expect(resolveRedisUrl()).toBe('redis://localhost:6379')
        })

        it('treats REDIS_TLS as disabled unless explicitly truthy', () => {
            expect(isRedisTlsEnabled({ REDIS_TLS: 'true' })).toBe(true)
            expect(isRedisTlsEnabled({ REDIS_TLS: '1' })).toBe(true)
            expect(isRedisTlsEnabled({ REDIS_TLS: 'false' })).toBe(false)
            expect(isRedisTlsEnabled({ REDIS_TLS: 'TRUE' })).toBe(true)
            expect(isRedisTlsEnabled({})).toBe(false)
        })
    })

    describe('failover detection', () => {
        it('recognises ElastiCache failover error signatures', () => {
            expect(isRedisFailoverError(new Error('READONLY You cannot write against a read only replica.'))).toBe(true)
            expect(isRedisFailoverError(new Error('CLUSTERDOWN The cluster is down'))).toBe(true)
            expect(isRedisFailoverError(new Error('LOADING Redis is loading the dataset in memory'))).toBe(true)
            expect(isRedisFailoverError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toBe(true)
        })

        it('does not classify auth errors as failover errors', () => {
            expect(isRedisFailoverError(new Error('NOAUTH Authentication required'))).toBe(false)
            expect(isRedisFailoverError(new Error('WRONGPASS invalid username-password pair'))).toBe(false)
        })
    })

    describe('redisRetryStrategy', () => {
        it('never gives up (never returns null)', () => {
            for (let attempt = 1; attempt <= 200; attempt++) {
                expect(redisRetryStrategy(attempt)).not.toBeNull()
            }
        })

        it('grows exponentially and is capped', () => {
            expect(redisRetryStrategy(1)).toBe(200)
            expect(redisRetryStrategy(2)).toBe(400)
            expect(redisRetryStrategy(3)).toBe(800)
            expect(redisRetryStrategy(50)).toBe(REDIS_RETRY_MAX_DELAY_MS)
            expect(redisRetryStrategy(0)).toBe(200)
            expect(redisRetryStrategy(Number.NaN)).toBe(200)
        })
    })

    describe('redisReconnectOnError', () => {
        it('replays commands the server provably did not execute', () => {
            expect(redisReconnectOnError(new Error('READONLY You cannot write against a read only replica.'))).toBe(2)
            expect(redisReconnectOnError(new Error('CLUSTERDOWN The cluster is down'))).toBe(2)
            expect(redisReconnectOnError(new Error('LOADING Redis is loading the dataset in memory'))).toBe(2)
        })

        it('reconnects without replaying after a socket drop', () => {
            expect(redisReconnectOnError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(1)
            // ioredis/Node sometimes surface the errno only in the message.
            expect(redisReconnectOnError(new Error('read ECONNRESET'))).toBe(1)
            expect(redisReconnectOnError(new Error('connect ETIMEDOUT'))).toBe(1)
            expect(redisReconnectOnError(new Error('connect ECONNREFUSED 10.0.1.5:6379'))).toBe(1)
            expect(redisReconnectOnError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(1)
        })

        it('does not reconnect on errors reconnecting cannot fix', () => {
            expect(redisReconnectOnError(new Error('NOAUTH Authentication required'))).toBe(false)
            expect(redisReconnectOnError(new Error('WRONGPASS invalid username-password pair'))).toBe(false)
            expect(redisReconnectOnError(new Error('NOPERM this user has no permissions'))).toBe(false)
        })
    })

    describe('client option presets', () => {
        it('default options are failover aware', () => {
            const options = getRedisClientOptions() as Record<string, unknown>
            expect(options.retryStrategy).toBe(redisRetryStrategy)
            expect(options.reconnectOnError).toBe(redisReconnectOnError)
            expect(options.enableOfflineQueue).toBe(true)
            expect(options.autoResubscribe).toBe(true)
            expect(typeof (options.retryStrategy as (n: number) => number)).toBe('function')
        })

        it('BullMQ options keep maxRetriesPerRequest null', () => {
            const options = getBullMqConnectionOptions() as Record<string, unknown>
            expect(options.maxRetriesPerRequest).toBeNull()
        })

        it('probe options fail fast', () => {
            const options = getRedisProbeOptions() as Record<string, unknown>
            expect(options.lazyConnect).toBe(true)
            const strategy = options.retryStrategy as (n: number) => number | null
            expect(strategy(1)).toBeNull()
        })

        it('callers can override any option', () => {
            const options = getRedisClientOptions({ maxRetriesPerRequest: 3 }) as Record<string, unknown>
            expect(options.maxRetriesPerRequest).toBe(3)
        })
    })
})
