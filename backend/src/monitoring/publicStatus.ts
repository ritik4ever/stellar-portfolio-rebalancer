import { ReflectorService } from '../services/reflector.js'
import { StellarDEXService } from '../services/dex.js'
import type { OracleReachabilityReason, OracleReachabilityResult } from '../services/reflector.js'
import type { DexConnectivityReason, DexConnectivityResult } from '../services/dex.js'
import { logger } from '../utils/logger.js'
import { getErrorMessage } from '../utils/helpers.js'

/**
 * Public connectivity status for the two upstreams a rebalance depends on:
 * the Reflector oracle that prices the portfolio, and the Stellar DEX that
 * executes the trades.
 *
 * Unlike `/health` (a liveness gate that answers 503) this report is meant to be
 * read by humans on a public status page, so every check carries a
 * human-readable `message` and the probe's own `reason` code. It is built from
 * the same probes the backend already runs for itself: the Reflector oracle
 * reachability check from the startup self-test (#1405) and the read-only
 * Horizon path-finding probe on `StellarDEXService`.
 */

export type PublicCheckStatus = 'ok' | 'degraded' | 'down'
export type PublicStatusOverall = 'healthy' | 'degraded' | 'unhealthy'
export type PublicCheckName = 'reflector_oracle' | 'stellar_dex'

export interface PublicStatusCheck {
    status: PublicCheckStatus
    last_checked: string
    latency_ms: number
    /** Raw probe reason, kept so the page can explain *why* a check is not ok. */
    reason: string
    message: string
    details?: Record<string, unknown>
}

export interface PublicStatusCacheInfo {
    /** True when this report was served from cache or from an in-flight probe. */
    cached: boolean
    age_ms: number
    ttl_ms: number
}

export interface PublicStatusReport {
    status: PublicStatusOverall
    timestamp: string
    checks: Record<PublicCheckName, PublicStatusCheck>
    cache: PublicStatusCacheInfo
}

export type PublicStatusProbe = (now: () => number) => Promise<PublicStatusCheck>

export interface PublicStatusProbeDeps {
    probeOracle?: PublicStatusProbe
    probeDex?: PublicStatusProbe
    now?: () => number
}

const DEFAULT_CACHE_TTL_MS = 15_000
const MAX_CACHE_TTL_MS = 300_000
const ORACLE_PROBE_TIMEOUT_MS = 5_000
const DEX_PROBE_TIMEOUT_MS = 5_000

/** The oracle is the primary price source with a fallback, so a broken oracle degrades rather than stops the service. */
const ORACLE_MESSAGES: Record<OracleReachabilityReason, string> = {
    ok: 'Reflector oracle is reachable and serving fresh quotes.',
    not_configured: 'Reflector oracle is not configured; prices fall back to a secondary source.',
    unreachable: 'Reflector oracle is unreachable; prices fall back to a secondary source.',
    timeout: 'Reflector oracle did not answer in time; prices fall back to a secondary source.',
    http_error: 'Reflector oracle returned an error response; prices fall back to a secondary source.',
    no_data: 'Reflector oracle answered but returned no price for the probed asset.',
    stale: 'Reflector oracle is reachable but its latest quotes are stale.',
}

const DEX_MESSAGES: Record<DexConnectivityReason, string> = {
    ok: 'Stellar DEX is reachable and quoting the probed pair.',
    no_path: 'Stellar DEX is reachable but found no route for the probed pair.',
    timeout: 'Stellar DEX did not answer the route query in time.',
    http_error: 'Stellar DEX returned an error response.',
    api_unavailable: 'Horizon client cannot query the Stellar DEX.',
    unsupported_asset: 'Probe assets are not configured with a known issuer.',
    error: 'Stellar DEX route query failed.',
}

let reflectorService: ReflectorService | undefined
let dexService: StellarDEXService | undefined

function getReflectorService(): ReflectorService {
    reflectorService ??= new ReflectorService()
    return reflectorService
}

function getDexService(): StellarDEXService {
    dexService ??= new StellarDEXService()
    return dexService
}

function measure(resultLatencyMs: unknown, fallbackLatencyMs: number): number {
    return typeof resultLatencyMs === 'number' && Number.isFinite(resultLatencyMs)
        ? resultLatencyMs
        : fallbackLatencyMs
}

/**
 * Map a Reflector oracle probe result onto a public check.
 *
 * Every non-`ok` reason is `degraded` rather than `down` on purpose: the oracle
 * is the primary price source and CoinGecko is the fallback, so an unreachable
 * oracle degrades pricing quality without stopping the service. `down` is
 * reserved for a probe that could not produce a result at all.
 */
export function mapOracleReachability(
    result: OracleReachabilityResult,
    latencyMs: number,
    lastChecked: string,
): PublicStatusCheck {
    const reason = result.reason
    const details: Record<string, unknown> = { asset: result.asset }
    if (result.endpoint !== undefined) details.endpoint = result.endpoint
    if (result.httpStatus !== undefined) details.http_status = result.httpStatus
    if (result.quoteTimestamp !== undefined) details.quote_timestamp = result.quoteTimestamp
    if (result.error !== undefined) details.error = result.error

    return {
        status: result.reachable && reason === 'ok' ? 'ok' : 'degraded',
        last_checked: lastChecked,
        latency_ms: measure(result.latencyMs, latencyMs),
        reason,
        message: ORACLE_MESSAGES[reason] ?? 'Reflector oracle status is unknown.',
        details,
    }
}

/**
 * Map a Stellar DEX probe result onto a public check.
 *
 * `no_path` is `degraded`, not `down`: Horizon answered, so the DEX connection
 * is up, but the probed pair currently has no route. Anything that prevented
 * Horizon from answering at all is `down`.
 */
export function mapDexConnectivity(
    result: DexConnectivityResult,
    latencyMs: number,
    lastChecked: string,
): PublicStatusCheck {
    const reason = result.reason
    const status: PublicCheckStatus = reason === 'ok'
        ? 'ok'
        : reason === 'no_path'
            ? 'degraded'
            : 'down'

    const details: Record<string, unknown> = {
        from_asset: result.fromAsset,
        to_asset: result.toAsset,
        path_count: result.pathCount,
    }
    if (result.bestDestinationAmount !== undefined) details.best_destination_amount = result.bestDestinationAmount
    if (result.httpStatus !== undefined) details.http_status = result.httpStatus
    if (result.error !== undefined) details.error = result.error

    return {
        status,
        last_checked: lastChecked,
        latency_ms: measure(result.latencyMs, latencyMs),
        reason,
        message: DEX_MESSAGES[reason] ?? 'Stellar DEX status is unknown.',
        details,
    }
}

/** Any `down` check makes the platform unhealthy; any `degraded` check makes it degraded. */
export function summarizePublicStatus(checks: PublicStatusCheck[]): PublicStatusOverall {
    if (checks.some((check) => check.status === 'down')) return 'unhealthy'
    if (checks.some((check) => check.status === 'degraded')) return 'degraded'
    return 'healthy'
}

/** Cache TTL in ms; `0` disables caching. Clamped so a public page can never hammer its upstreams. */
export function getPublicStatusCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
    const parsed = Number.parseInt(env.PUBLIC_STATUS_CACHE_TTL_MS ?? '', 10)
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CACHE_TTL_MS
    return Math.min(parsed, MAX_CACHE_TTL_MS)
}

/** Live Reflector oracle check, reusing the startup self-test's reachability probe. */
export async function probeReflectorOracle(now: () => number = Date.now): Promise<PublicStatusCheck> {
    const startedAt = Date.now()
    const lastChecked = new Date(now()).toISOString()

    try {
        const result = await getReflectorService().testOracleReachability({ timeoutMs: ORACLE_PROBE_TIMEOUT_MS })
        return mapOracleReachability(result, Date.now() - startedAt, lastChecked)
    } catch (error) {
        return {
            status: 'down',
            last_checked: lastChecked,
            latency_ms: Date.now() - startedAt,
            reason: 'error',
            message: 'Reflector oracle reachability probe failed.',
            details: { error: getErrorMessage(error) },
        }
    }
}

/** Live Stellar DEX check: strict-send route finding against Horizon for one configured pair. */
export async function probeStellarDex(now: () => number = Date.now): Promise<PublicStatusCheck> {
    const startedAt = Date.now()
    const lastChecked = new Date(now()).toISOString()

    try {
        const result = await getDexService().probeDexConnectivity({
            fromAsset: process.env.PUBLIC_STATUS_DEX_FROM_ASSET || 'XLM',
            toAsset: process.env.PUBLIC_STATUS_DEX_TO_ASSET || 'USDC',
            timeoutMs: DEX_PROBE_TIMEOUT_MS,
        })
        return mapDexConnectivity(result, Date.now() - startedAt, lastChecked)
    } catch (error) {
        return {
            status: 'down',
            last_checked: lastChecked,
            latency_ms: Date.now() - startedAt,
            reason: 'error',
            message: 'Stellar DEX route probe failed.',
            details: { error: getErrorMessage(error) },
        }
    }
}

async function runProbe(
    name: PublicCheckName,
    probe: PublicStatusProbe,
    now: () => number,
): Promise<PublicStatusCheck> {
    try {
        return await probe(now)
    } catch (error) {
        logger.warn('[STATUS] Public status probe failed', { check: name, error: getErrorMessage(error) })
        return {
            status: 'down',
            last_checked: new Date(now()).toISOString(),
            latency_ms: 0,
            reason: 'error',
            message: `${name.replace('_', ' ')} probe failed.`,
            details: { error: getErrorMessage(error) },
        }
    }
}

/** Run both probes and summarise them. Always probes; caching lives in `getPublicStatus`. */
export async function buildPublicStatus(deps: PublicStatusProbeDeps = {}): Promise<PublicStatusReport> {
    const now = deps.now ?? Date.now
    const ttlMs = getPublicStatusCacheTtlMs()

    const [oracle, dex] = await Promise.all([
        runProbe('reflector_oracle', deps.probeOracle ?? probeReflectorOracle, now),
        runProbe('stellar_dex', deps.probeDex ?? probeStellarDex, now),
    ])

    return {
        status: summarizePublicStatus([oracle, dex]),
        timestamp: new Date(now()).toISOString(),
        checks: { reflector_oracle: oracle, stellar_dex: dex },
        cache: { cached: false, age_ms: 0, ttl_ms: ttlMs },
    }
}

function withCacheInfo(
    report: PublicStatusReport,
    cached: boolean,
    ageMs: number,
    ttlMs: number,
): PublicStatusReport {
    return { ...report, cache: { cached, age_ms: Math.max(0, Math.round(ageMs)), ttl_ms: ttlMs } }
}

let cachedReport: PublicStatusReport | undefined
let cachedAtMs = 0
let inFlight: Promise<PublicStatusReport> | undefined

/** Drop the cached report. Used by tests and when probe configuration changes. */
export function resetPublicStatusCache(): void {
    cachedReport = undefined
    cachedAtMs = 0
    inFlight = undefined
}

/**
 * Cached entry point for the public status route.
 *
 * A public page gets polled, so a fresh probe per request would hammer Horizon
 * and the oracle. Reports younger than `PUBLIC_STATUS_CACHE_TTL_MS` are reused,
 * and concurrent callers share a single in-flight probe instead of each
 * starting their own. Passing explicit probes (tests) or a TTL of `0` bypasses
 * the cache entirely.
 */
export async function getPublicStatus(deps: PublicStatusProbeDeps = {}): Promise<PublicStatusReport> {
    const now = deps.now ?? Date.now
    const ttlMs = getPublicStatusCacheTtlMs()
    const bypassCache = ttlMs <= 0 || deps.probeOracle !== undefined || deps.probeDex !== undefined

    if (!bypassCache) {
        const fresh = cachedReport
        const ageMs = now() - cachedAtMs
        if (fresh !== undefined && ageMs >= 0 && ageMs < ttlMs) {
            return withCacheInfo(fresh, true, ageMs, ttlMs)
        }
        const pending = inFlight
        if (pending !== undefined) {
            return withCacheInfo(await pending, true, 0, ttlMs)
        }
    }

    const probeRun = buildPublicStatus(deps)
    if (bypassCache) return probeRun

    inFlight = probeRun
    try {
        const report = await probeRun
        cachedReport = report
        cachedAtMs = now()
        return report
    } finally {
        inFlight = undefined
    }
}
