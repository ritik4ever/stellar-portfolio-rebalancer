import { rateLimit, type Options } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { default as IORedis } from 'ioredis'
import { REDIS_URL } from '../queue/connection.js'
import { logger } from '../utils/logger.js'

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000
const max = Number(process.env.RATE_LIMIT_MAX) || 100
const writeMax = Number(process.env.RATE_LIMIT_WRITE_MAX) || 10

let redisClient: IORedis | undefined;

if (process.env.NODE_ENV !== 'test') {
    try {
        redisClient = new IORedis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            enableReadyCheck: false,
        });
        redisClient.on('error', (err) => {
            // Suppress unhandled rejections during test or when Redis is down
            logger.warn('[RATE-LIMIT] Redis connection error: ' + err.message);
        });
    } catch (error) {
        logger.warn('[RATE-LIMIT] Failed to initialize Redis store, falling back to memory store: ', error);
    }
}

function createRedisStore(prefix: string): RedisStore | undefined {
    if (!redisClient) return undefined;
    return new RedisStore({
        prefix,
        sendCommand: async (...args: string[]) => {
            if (args.length === 0) return;
            const command = args[0];
            const rest = args.slice(1);
            return await redisClient!.call(command, ...rest) as any;
        }
    });
}

function createHandler(ms: number) {
    const retryAfterSec = Math.ceil(ms / 1000)
    return (req: import('express').Request, res: import('express').Response) => {
        res.setHeader('Retry-After', String(retryAfterSec))
        res.status(429).json({
            success: false,
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: retryAfterSec
        })
    }
}

const baseOptions: Partial<Options> = {
    windowMs,
    standardHeaders: true,
    legacyHeaders: false
}

export const globalRateLimiter = rateLimit({
    ...baseOptions,
    max,
    handler: createHandler(windowMs),
    store: createRedisStore('rl:global:')
})

export const writeRateLimiter = rateLimit({
    ...baseOptions,
    max: writeMax,
    handler: createHandler(windowMs),
    store: createRedisStore('rl:write:'),
    keyGenerator: (req) => {
        // IP + wallet-address based throttling for critical routes
        const walletAddress = req.body?.userAddress || req.params?.address || 'unknown';
        const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
        return `write_limit:${walletAddress}:${ip}`;
    }
})
