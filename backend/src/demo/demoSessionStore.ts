/**
 * Redis-based session store for demo mode.
 *
 * Demo sessions are identified by a session key passed in the X-Demo-Session header.
 * Each session holds an isolated demo portfolio keyed to that session only.
 * Sessions expire after 1 hour (TTL enforced by Redis).
 *
 * Usage:
 *   const sessionKey = req.headers['x-demo-session'] as string
 *   const session = await getDemoSession(sessionKey)
 *   session.portfolio = { ... }
 *   await saveDemoSession(sessionKey, session)
 */
import * as queueConnection from '../queue/connection.js'
import { logger } from '../utils/logger.js'
import type { Redis } from 'ioredis'

const SESSION_TTL_SECONDS = 60 * 60   // 1 hour
const KEY_PREFIX = 'demo:session:'

export interface DemoSession {
    createdAt: string
    portfolio?: Record<string, unknown>
    [key: string]: unknown
}

let redis: Redis | null = null

async function getRedis(forceRefresh = false): Promise<Redis | null> {
    if (redis && !forceRefresh) return redis
    try {
        const url =
            typeof queueConnection.getRedisUrl === 'function'
                ? queueConnection.getRedisUrl(forceRefresh)
                : queueConnection.REDIS_URL
        const ioredisMod = await import('ioredis')
        const IORedis = (ioredisMod as any).default || ioredisMod
        const client = new IORedis(url, {
            maxRetriesPerRequest: 1,
            enableReadyCheck: false,
            lazyConnect: true,
        })
        if (typeof client.on === 'function') {
            client.on('error', (err: Error) => {
                const msg = (err.message || '').toLowerCase()
                if (msg.includes('noauth') || msg.includes('wrongpass') || msg.includes('authentication')) {
                    logger.warn('[demoSession] Redis authentication error detected — refreshing credentials...')
                    redis = null
                    if (typeof queueConnection.refreshRedisCredentials === 'function') {
                        queueConnection.refreshRedisCredentials().catch(() => {})
                    }
                }
            })
        }
        await client.connect()
        redis = client
        return redis
    } catch (err) {
        logger.warn('[demoSession] Redis unavailable — demo sessions will not persist', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }
}

function sessionKey(token: string): string {
    return `${KEY_PREFIX}${token}`
}

export async function getDemoSession(token: string): Promise<DemoSession | null> {
    const client = await getRedis()
    if (!client) return null
    const raw = await client.get(sessionKey(token))
    if (!raw) return null
    try {
        return JSON.parse(raw) as DemoSession
    } catch {
        return null
    }
}

export async function saveDemoSession(token: string, session: DemoSession): Promise<void> {
    const client = await getRedis()
    if (!client) return
    await client.setex(sessionKey(token), SESSION_TTL_SECONDS, JSON.stringify(session))
}

export async function deleteDemoSession(token: string): Promise<void> {
    const client = await getRedis()
    if (!client) return
    await client.del(sessionKey(token))
}

export async function touchDemoSession(token: string): Promise<boolean> {
    const client = await getRedis()
    if (!client) return false
    const result = await client.expire(sessionKey(token), SESSION_TTL_SECONDS)
    return result === 1
}
