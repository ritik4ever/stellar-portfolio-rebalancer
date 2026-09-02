/**
 * Integration test for the failover preset's handling of writes issued while
 * the Redis connection is down (review #1728, round 2).
 *
 * Uses a minimal fake RESP server over `node:net` to control the exact
 * disconnect -> write -> reconnect timeline deterministically (no real Redis
 * instance required). It proves both halves of the `enableOfflineQueue`
 * decision:
 *
 *   1. With the shared failover preset (`enableOfflineQueue: false`), a
 *      write issued while disconnected is rejected immediately and is NEVER
 *      delivered later — so callers deterministically take their in-memory
 *      fallback path (dead-letter list, revocation set, lock).
 *   2. With the ioredis default (`enableOfflineQueue: true`), the same write
 *      is rejected by `commandTimeout` while the client is still down, but
 *      ioredis keeps it in the offline queue and flushes it to the server
 *      after the reconnect — a delayed side effect nobody is awaiting. This
 *      is the hazard the preset change removes for service clients
 *      (verified against ioredis v5.9.3).
 *   3. BullMQ connection options deliberately opt back into the offline
 *      queue (queue operations are idempotent by job ID).
 */
import net from 'node:net'
import Redis from 'ioredis'
import { describe, expect, it } from 'vitest'
import {
    getBullMqConnectionOptions,
    getRedisClientOptions,
    getRedisProbeOptions,
} from '../config/redisConnectionOptions.js'

/** Key/value shaped like the writes webhookDeadLetter.push() issues. */
const WRITE_KEY = 'dead_letter:webhook'
const WRITE_VALUE = 'ITEM-42'

interface FakeRedisServer {
    port: number
    received: string[]
    stop(): void
}

/**
 * Starts a fake Redis server that replies `+OK` to every command and records
 * the raw bytes it receives (enough to detect whether a write was replayed).
 * With `enableReadyCheck: false` no INFO handshake is needed.
 */
function startFakeRedis(port: number, received: string[]): Promise<FakeRedisServer> {
    return new Promise((resolve, reject) => {
        const sockets: net.Socket[] = []
        const server = net.createServer((socket) => {
            sockets.push(socket)
            socket.on('data', (buf) => {
                received.push(buf.toString('latin1'))
                socket.write('+OK\r\n')
            })
            socket.on('error', () => {})
        })
        server.on('error', reject)
        server.listen(port, '127.0.0.1', () => {
            resolve({
                port: (server.address() as net.AddressInfo).port,
                received,
                stop(): void {
                    for (const socket of sockets.splice(0)) socket.destroy()
                    server.close()
                },
            })
        })
    })
}

const onceReady = (client: Redis): Promise<void> =>
    new Promise((resolve) => client.once('ready', () => resolve()))

/** Resolves once the client has observed the dropped connection. */
const onceClosed = (client: Redis): Promise<void> =>
    new Promise((resolve) => {
        if (client.status !== 'ready') return resolve()
        client.once('close', () => resolve())
    })

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface ReplayOutcome {
    /** Rejection message the awaiting caller saw ('' when it resolved). */
    rejection: string
    /** How long the caller waited before the rejection. */
    rejectionMs: number
    /** Whether the write reached the server AFTER the reconnect. */
    replayedAfterReconnect: boolean
}

/**
 * Runs one disconnect -> write -> reconnect cycle against the shared preset
 * (with `enableOfflineQueue` pinned to the value under test) and reports how
 * the write failed and whether it was later replayed to the server.
 */
async function replayScenario(offlineQueueEnabled: boolean): Promise<ReplayOutcome> {
    const received: string[] = []
    let server = await startFakeRedis(0, received)
    const port = server.port

    const client = new Redis({
        ...getRedisClientOptions({
            // Pin the option under test; tighten the timings so the scenario
            // stays fast and deterministic.
            enableOfflineQueue: offlineQueueEnabled,
            commandTimeout: 300,
            connectTimeout: 1_000,
            retryStrategy: () => 200,
            enableReadyCheck: false,
        }),
        host: '127.0.0.1',
        port,
    })
    // Reconnection noise is expected throughout the scenario.
    client.on('error', () => {})

    try {
        await onceReady(client)
        received.length = 0

        // Simulate the failover: the primary dies with the connection.
        server.stop()
        await onceClosed(client)

        // A service write of the same shape webhookDeadLetter.push() issues
        // while the connection is down.
        const startedAt = Date.now()
        let rejection = ''
        try {
            await client.rpush(WRITE_KEY, WRITE_VALUE)
        } catch (err) {
            rejection = err instanceof Error ? err.message : String(err)
        }
        const rejectionMs = Date.now() - startedAt

        // Recovery: a new primary answers on the same endpoint and the
        // client reconnects through its retry strategy.
        server = await startFakeRedis(port, received)
        await onceReady(client)
        // Give a (hypothetical) offline-queue flush time to hit the wire.
        await sleep(300)

        const replayedAfterReconnect = received.join('').includes(WRITE_VALUE)
        return { rejection, rejectionMs, replayedAfterReconnect }
    } finally {
        client.disconnect()
        server.stop()
    }
}

describe('redis offline-queue failover behavior (review #1728)', () => {
    it(
        'preset (enableOfflineQueue=false): disconnected writes fail fast and are never replayed',
        { timeout: 20_000 },
        async () => {
            const outcome = await replayScenario(false)

            // Rejected immediately by the offline-queue guard — no 300 ms
            // commandTimeout wait.
            expect(outcome.rejection).toMatch(/enableOfflineQueue/)
            expect(outcome.rejectionMs).toBeLessThan(150)
            // The rejected write must never reach the server after the
            // reconnect: the caller already fell back to its in-memory store.
            expect(outcome.replayedAfterReconnect).toBe(false)
        }
    )

    it(
        'ioredis default (enableOfflineQueue=true): timed-out writes are replayed after reconnect (documented hazard)',
        { timeout: 20_000 },
        async () => {
            const outcome = await replayScenario(true)

            // The caller's promise is rejected by commandTimeout while the
            // client is still disconnected...
            expect(outcome.rejection).toMatch(/timed out/i)
            // ...yet ioredis keeps the command in the offline queue and
            // flushes it once the connection recovers — a delayed write the
            // caller already handled via its fallback path. This is exactly
            // why the shared preset disables the offline queue for service
            // clients.
            expect(outcome.replayedAfterReconnect).toBe(true)
        }
    )

    it('shared preset disables the offline queue; probes inherit it; BullMQ opts back in', () => {
        expect(getRedisClientOptions().enableOfflineQueue).toBe(false)
        expect(getRedisProbeOptions().enableOfflineQueue).toBe(false)
        expect(getBullMqConnectionOptions().enableOfflineQueue).toBe(true)
    })
})
