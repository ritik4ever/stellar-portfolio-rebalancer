/**
 * Shared Redis connection settings for every backend Redis client.
 *
 * ─── Why this module exists ──────────────────────────────────────────────────
 * In AWS the backend talks to an ElastiCache **replication group** running with
 * Multi-AZ and automatic failover enabled
 * (see `deployment/terraform/modules/elasticache`).
 *
 * Applications must connect to the *replication-group endpoint* — the primary
 * endpoint (`REDIS_HOST`) for reads+writes and the reader endpoint
 * (`REDIS_READER_HOST`) for read-only traffic. These are stable DNS names owned
 * by ElastiCache, **not** the address of any individual node.
 *
 * When the primary node — or the entire availability zone hosting it — becomes
 * unavailable, ElastiCache promotes a read replica from another AZ and repoints
 * that endpoint's DNS record at the promoted node. The consequences for clients:
 *
 *   1. The endpoint name never changes, so no configuration change is needed.
 *   2. The existing TCP connection is dropped and in-flight commands fail with
 *      `READONLY`, `CLUSTERDOWN`, `MASTERDOWN`, `ECONNRESET`, … for the
 *      duration of the switchover (typically a few seconds, occasionally up to
 *      a couple of minutes).
 *   3. A client therefore has to **keep reconnecting with bounded backoff** and
 *      re-resolve DNS, instead of giving up or latching into a permanent
 *      "Redis is down" state.
 *
 * The options below encode exactly that behaviour. See
 * `deployment/terraform/modules/elasticache/README.md` for the operator-facing
 * description of the same flow.
 */

import type { RedisOptions } from 'ioredis'

/** How long to wait for a TCP connect to the replication group endpoint. */
export const REDIS_CONNECT_TIMEOUT_MS = 10_000

/** Upper bound for a single command before ioredis rejects it. */
export const REDIS_COMMAND_TIMEOUT_MS = 15_000

/** Base delay for the reconnect backoff (doubles up to the cap below). */
export const REDIS_RETRY_BASE_DELAY_MS = 200

/** Ceiling for the reconnect backoff. */
export const REDIS_RETRY_MAX_DELAY_MS = 5_000

/**
 * Number of times ioredis retries a command while a connection is down.
 * `null` (retry forever) is required by BullMQ; a finite but generous value is
 * used elsewhere so a failover does not surface as an application error.
 */
export const REDIS_MAX_RETRIES_PER_REQUEST = 20

/**
 * Error signatures emitted by ElastiCache / Redis during a failover or while a
 * replica is being promoted and is still loading its dataset.
 */
const FAILOVER_MESSAGE_PATTERNS: RegExp[] = [
    // Replica answered a write before promotion completed.
    /\bREADONLY\b/i,
    // Cluster/replication group is unavailable mid-election.
    /\bCLUSTERDOWN\b/i,
    /\bMASTERDOWN\b/i,
    // Node is loading its dataset after a restart/failover.
    /\bLOADING\b/i,
    // Server closed / reset the socket during the switchover.
    /\bconnection is closed\b/i,
    /\bstream isn'?t writeable\b/i,
    /\bsocket closed unexpectedly\b/i,
    /\bsocket hang up\b/i,
    // Transport-level errno names. These normally also arrive as `err.code`,
    // but ioredis/Node surface some of them only in the message, so match
    // both to be safe (e.g. "read ECONNRESET").
    /\bECONNRESET\b/i,
    /\bECONNREFUSED\b/i,
    /\bETIMEDOUT\b/i,
    /\bEHOSTUNREACH\b/i,
    /\bENETUNREACH\b/i,
    /\bEPIPE\b/i,
]

const FAILOVER_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
])

/** True when `err` looks like a transient ElastiCache failover symptom. */
export function isRedisFailoverError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
    const code = (err as { code?: string } | null)?.code
    if (code && FAILOVER_ERROR_CODES.has(String(code).toUpperCase())) return true
    return FAILOVER_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * ioredis `retryStrategy`. Always returns a delay (never `null`) so the client
 * keeps reconnecting for as long as a failover takes; the delay grows
 * exponentially from 200 ms up to 5 s.
 */
export function redisRetryStrategy(times: number): number {
    const attempt = Number.isFinite(times) && times > 0 ? times : 1
    const exponent = Math.min(attempt - 1, 6)
    return Math.min(REDIS_RETRY_BASE_DELAY_MS * 2 ** exponent, REDIS_RETRY_MAX_DELAY_MS)
}

/**
 * ioredis `reconnectOnError`.
 *
 * - returns `2` → reconnect **and resend** the failed command. Only safe for
 *   errors where the server provably did *not* execute it (`READONLY`,
 *   `CLUSTERDOWN`, `LOADING`, …).
 * - returns `1` → reconnect without resending (socket-level failures where the
 *   command may already have been applied).
 * - returns `false` → let ioredis reject the command (e.g. auth/permission
 *   errors, which reconnecting will never fix).
 */
export function redisReconnectOnError(err: unknown): boolean | 1 | 2 {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
    const lower = message.toLowerCase()

    // Server rejected the command without executing it → safe to replay.
    if (
        /\breadonly\b/.test(lower) ||
        /\bclusterdown\b/.test(lower) ||
        /\bmasterdown\b/.test(lower) ||
        /\bloading\b/.test(lower) ||
        /\btry again\b/.test(lower)
    ) {
        return 2
    }

    // Socket dropped → reconnect, but do not replay (outcome unknown).
    if (isRedisFailoverError(err)) return 1

    return false
}

/** Overrides accepted by {@link getRedisClientOptions}. */
export interface RedisClientOptionsOverrides {
    /** BullMQ requires `null` (retry forever) — pass it through here. */
    maxRetriesPerRequest?: number | null
    connectTimeout?: number
    commandTimeout?: number
    lazyConnect?: boolean
    enableReadyCheck?: boolean
    enableOfflineQueue?: boolean
    retryStrategy?: RedisOptions['retryStrategy']
    reconnectOnError?: RedisOptions['reconnectOnError']
    [key: string]: unknown
}

/**
 * Default, failover-aware ioredis options for a client pointed at the
 * ElastiCache replication-group endpoint.
 *
 * Callers override only what they genuinely need (e.g. BullMQ sets
 * `maxRetriesPerRequest: null`, short-lived probes disable retries entirely).
 */
export function getRedisClientOptions(overrides: RedisClientOptionsOverrides = {}): RedisOptions {
    return {
        retryStrategy: redisRetryStrategy,
        reconnectOnError: redisReconnectOnError,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
        maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
        enableReadyCheck: true,
        // Queue commands issued during the failover window instead of rejecting
        // them, so callers simply observe latency rather than an error.
        enableOfflineQueue: true,
        // Re-establish subscriptions automatically after a reconnect.
        autoResubscribe: true,
        autoResendUnfulfilledCommands: true,
        ...overrides,
    } as RedisOptions
}

/**
 * Options for throwaway reachability probes: fail fast, never retry.
 * Used by `redisProbe` so startup checks stay quick even when Redis is absent.
 */
export function getRedisProbeOptions(overrides: RedisClientOptionsOverrides = {}): RedisOptions {
    return getRedisClientOptions({
        lazyConnect: true,
        connectTimeout: 3_000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        retryStrategy: () => null,
        ...overrides,
    })
}

/** Options for BullMQ Queues and Workers. */
export function getBullMqConnectionOptions(overrides: RedisClientOptionsOverrides = {}): RedisOptions {
    return getRedisClientOptions({
        // BullMQ requires `null`: it manages its own retry/blocking semantics
        // and a finite value breaks blocking commands.
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
        ...overrides,
    })
}

export interface RedisTargetInput {
    /**
     * `host[:port]` as injected by Terraform (`REDIS_HOST`). This is the
     * replication-group **primary** endpoint, not a node address.
     */
    host?: string | null
    /** Fully-formed URL from `REDIS_URL`. Takes precedence over `host`. */
    url?: string | null
    /** Redis AUTH token (Secrets Manager `auth_token`). */
    authToken?: string | null
    /**
     * Use the `rediss://` (TLS) scheme. Set when the replication group has
     * `transit_encryption_enabled = true` — Terraform exports this as `REDIS_TLS`.
     */
    tls?: boolean
    /** Used when neither `host` nor `url` is provided. */
    fallback?: string
}

export const DEFAULT_REDIS_URL = 'redis://localhost:6379'

/**
 * Builds the Redis connection URL the backend should dial.
 *
 * Precedence mirrors the deployment layout:
 *   1. `REDIS_URL` when set (local dev, docker-compose, tests).
 *   2. `REDIS_HOST` — the ElastiCache replication-group endpoint provided by
 *      Terraform — scheme added automatically (`rediss://` when TLS is on).
 *   3. `redis://localhost:6379`.
 *
 * A bare `host:port` is *never* treated as a node address: the endpoint handed
 * to us by Terraform is the replication-group endpoint, so failing over to a
 * replica in another AZ needs no client-side change.
 */
export function buildRedisUrl(input: RedisTargetInput = {}): string {
    const { host, url, authToken, tls = false } = input
    const fallback = input.fallback ?? DEFAULT_REDIS_URL

    const rawHost = typeof host === 'string' ? host.trim() : ''
    const rawUrl = typeof url === 'string' ? url.trim() : ''

    let result = rawUrl || (rawHost ? rawHost : fallback)

    // Normalise the scheme: ElastiCache with encryption in transit requires TLS,
    // which ioredis enables through the `rediss://` scheme.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(result)) {
        result = `${tls ? 'rediss' : 'redis'}://${result}`
    } else if (tls && /^redis:\/\//i.test(result)) {
        result = result.replace(/^redis:\/\//i, 'rediss://')
    }

    // Inject the AUTH token when it is not already embedded in the URL.
    const token = typeof authToken === 'string' ? authToken.trim() : ''
    if (token && !result.includes('@')) {
        result = result.replace(/^(rediss?:\/\/)/i, `$1:${encodeURIComponent(token)}@`)
    }

    return result
}

/** True when `REDIS_TLS` requests TLS (ElastiCache transit encryption). */
export function isRedisTlsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = env.REDIS_TLS?.trim().toLowerCase()
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on'
}

/**
 * Resolves the Redis URL straight from `process.env`, honouring the
 * `REDIS_URL` → `REDIS_HOST` → localhost precedence and `REDIS_TLS`.
 */
export function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
    return buildRedisUrl({
        url: env.REDIS_URL,
        host: env.REDIS_HOST,
        authToken: env.REDIS_AUTH_TOKEN ?? env.REDIS_PASSWORD,
        tls: isRedisTlsEnabled(env),
    })
}
