import { logger } from '../utils/logger.js'

/**
 * Structured, operator-facing outcomes for rebalance guardrails
 * (circuit breaker, cooldown enforcement, concentration limit).
 *
 * Every guardrail decision is classified into one of three outcomes so that
 * operators can tell work apart from logs/audit signals alone:
 *
 *  - `allowed` – the guardrail passed; the work proceeds.
 *  - `delayed` – the guardrail held the work back for a transient reason
 *                (cooldown not expired, prices stale, a partial fill still
 *                has legs pending). It clears on its own and the next
 *                scheduled cycle retries.
 *  - `blocked` – the guardrail refused the work for a reason that will not
 *                clear by waiting (e.g. the target allocation itself breaches
 *                the concentration cap). Operator or user action is needed.
 *
 * Context fields are restricted to identifiers, timestamps, and numeric
 * measurements. Never put wallet secrets, signatures, keys, or user addresses
 * into `context`.
 */

export type GuardrailName = 'circuit_breaker' | 'cooldown' | 'concentration_limit'
export type GuardrailOutcomeKind = 'allowed' | 'delayed' | 'blocked'

export type GuardrailReasonCode =
    // circuit breaker
    | 'MARKET_OK'
    | 'HIGH_VOLATILITY'
    | 'STALE_PRICE_DATA'
    | 'CORRELATION_BREAKDOWN'
    | 'STALE_PRICES_WHILE_QUEUED'
    | 'QUEUED_PRICES_FRESH'
    | 'CIRCUIT_BREAKER_ACTIVE'
    | 'VOLATILITY_DATA_INCOMPLETE'
    // cooldown
    | 'COOLDOWN_EXPIRED'
    | 'COOLDOWN_NO_PRIOR_RUN'
    | 'COOLDOWN_ACTIVE'
    | 'COOLDOWN_ALREADY_CLAIMED'
    // concentration
    | 'CONCENTRATION_WITHIN_CAP'
    | 'CONCENTRATION_OVER_CAP'
    | 'CONCENTRATION_PARTIAL_FILL_OVER_CAP'
    | 'CONCENTRATION_PARTIAL_FILL_STUCK'
    | 'INSUFFICIENT_DIVERSIFICATION'

export type GuardrailContextValue = string | number | boolean | null | undefined

export interface GuardrailOutcome {
    guardrail: GuardrailName
    /** Component that evaluated the guardrail, e.g. `auto_rebalance`, `rebalance_worker`. */
    source: string
    outcome: GuardrailOutcomeKind
    reasonCode: GuardrailReasonCode
    reason: string
    portfolioId?: string
    evaluatedAt: string
    context: Record<string, GuardrailContextValue>
}

/**
 * Emit a guardrail outcome as a single structured log line. `allowed` is
 * logged at debug, `delayed` at info, and `blocked` at warn, so default log
 * levels already separate the three. Returns the outcome for chaining.
 */
export function emitGuardrailOutcome(outcome: GuardrailOutcome): GuardrailOutcome {
    const payload = {
        guardrail: outcome.guardrail,
        source: outcome.source,
        outcome: outcome.outcome,
        reasonCode: outcome.reasonCode,
        reason: outcome.reason,
        portfolioId: outcome.portfolioId,
        evaluatedAt: outcome.evaluatedAt,
        ...outcome.context,
    }
    const message = `[GUARDRAIL] ${outcome.guardrail} ${outcome.outcome}`
    try {
        if (outcome.outcome === 'blocked') logger.warn(message, payload)
        else if (outcome.outcome === 'delayed') logger.info(message, payload)
        else logger.debug(message, payload)
    } catch {
        // Logging must never change guardrail behaviour.
    }
    return outcome
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker: prices that go stale while an execution sits in the queue
// ─────────────────────────────────────────────────────────────────────────────

/** Same window used by CircuitBreakers.checkDataFreshness (10 minutes). */
export const MAX_PRICE_AGE_MS = 10 * 60 * 1000

/**
 * Return the oldest price timestamp (epoch ms) in a prices map, or undefined
 * when no entry carries a usable timestamp. Reflector timestamps are in
 * seconds; values that already look like milliseconds are kept as-is.
 */
export function oldestPriceTimestampMs(prices: Record<string, { timestamp?: number } | undefined>): number | undefined {
    let oldest: number | undefined
    for (const data of Object.values(prices ?? {})) {
        const ts = data?.timestamp
        if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) continue
        const ms = ts < 1e12 ? ts * 1000 : ts
        if (oldest === undefined || ms < oldest) oldest = ms
    }
    return oldest
}

export interface QueuedPriceFreshnessInput {
    portfolioId?: string
    source: string
    /** Oldest price timestamp (ms) in the snapshot the enqueue decision used. */
    pricesObservedAtMs: number
    /** When the job was enqueued (ms). */
    enqueuedAtMs?: number
    nowMs?: number
    maxAgeMs?: number
}

/**
 * Re-check, at execution time, that the price snapshot an execution was
 * enqueued against is still inside the freshness window. A snapshot that
 * aged out while the job waited is reported as `delayed` – the next
 * scheduled cycle re-evaluates with fresh prices.
 */
export function evaluateQueuedPriceFreshness(input: QueuedPriceFreshnessInput): GuardrailOutcome {
    const nowMs = input.nowMs ?? Date.now()
    const maxAgeMs = input.maxAgeMs ?? MAX_PRICE_AGE_MS
    const priceAgeMs = Math.max(0, nowMs - input.pricesObservedAtMs)
    const queuedForMs = input.enqueuedAtMs !== undefined ? Math.max(0, nowMs - input.enqueuedAtMs) : undefined
    const stale = priceAgeMs > maxAgeMs

    return {
        guardrail: 'circuit_breaker',
        source: input.source,
        outcome: stale ? 'delayed' : 'allowed',
        reasonCode: stale ? 'STALE_PRICES_WHILE_QUEUED' : 'QUEUED_PRICES_FRESH',
        reason: stale
            ? `Price snapshot is ${Math.floor(priceAgeMs / 1000)}s old at execution time (max ${Math.floor(maxAgeMs / 1000)}s); execution deferred to the next cycle`
            : 'Price snapshot still fresh at execution time',
        portfolioId: input.portfolioId,
        evaluatedAt: new Date(nowMs).toISOString(),
        context: {
            pricesObservedAt: new Date(input.pricesObservedAtMs).toISOString(),
            enqueuedAt: input.enqueuedAtMs !== undefined ? new Date(input.enqueuedAtMs).toISOString() : undefined,
            priceAgeMs,
            queuedForMs,
            maxAgeMs,
        },
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cooldown enforcement
// ─────────────────────────────────────────────────────────────────────────────

const MS_PER_HOUR = 60 * 60 * 1000

/** Convert a cooldown in hours to whole milliseconds (avoids float drift at the boundary). */
export function cooldownHoursToMs(hours: number): number {
    if (!Number.isFinite(hours) || hours <= 0) return 0
    return Math.round(hours * MS_PER_HOUR)
}

function parseTimestampMs(value: string | number | Date | null | undefined): number | undefined {
    if (value === null || value === undefined || value === '') return undefined
    const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime()
    return Number.isFinite(ms) ? ms : undefined
}

export interface CooldownDecisionInput {
    portfolioId?: string
    source: string
    lastRebalance: string | number | Date | null | undefined
    minCooldownHours: number
    nowMs?: number
}

export interface CooldownDecision extends GuardrailOutcome {
    guardrail: 'cooldown'
    /** Effective last-run time the decision was computed from (ISO), if any. */
    lastRunAt?: string
    /** Instant the cooldown expires (ISO), if a prior run exists. */
    cooldownEndsAt?: string
    remainingMs: number
}

/**
 * Pure cooldown decision.
 *
 * Boundary contract: the cooldown window is half-open `[lastRun, lastRun + cooldown)`.
 * A request evaluated exactly at `lastRun + cooldown` is **permitted**. All
 * arithmetic is in integer milliseconds so the boundary instant is stable
 * and does not depend on floating-point hour fractions.
 *
 * A missing or unparseable last-run time means there is no prior run to cool
 * down from, so the request is permitted with `COOLDOWN_NO_PRIOR_RUN`.
 * A last-run time in the future (clock skew) keeps the cooldown active.
 */
export function evaluateCooldown(input: CooldownDecisionInput): CooldownDecision {
    const nowMs = input.nowMs ?? Date.now()
    const cooldownMs = cooldownHoursToMs(input.minCooldownHours)
    const lastRunMs = parseTimestampMs(input.lastRebalance)
    const evaluatedAt = new Date(nowMs).toISOString()

    if (lastRunMs === undefined) {
        return {
            guardrail: 'cooldown',
            source: input.source,
            outcome: 'allowed',
            reasonCode: 'COOLDOWN_NO_PRIOR_RUN',
            reason: 'No prior rebalance recorded; cooldown does not apply',
            portfolioId: input.portfolioId,
            evaluatedAt,
            remainingMs: 0,
            context: { cooldownMs, evaluatedAtMs: nowMs },
        }
    }

    const endsAtMs = lastRunMs + cooldownMs
    const remainingMs = Math.max(0, endsAtMs - nowMs)
    const active = nowMs < endsAtMs
    const base = {
        guardrail: 'cooldown' as const,
        source: input.source,
        portfolioId: input.portfolioId,
        evaluatedAt,
        lastRunAt: new Date(lastRunMs).toISOString(),
        cooldownEndsAt: new Date(endsAtMs).toISOString(),
        remainingMs,
        context: {
            cooldownMs,
            lastRunAt: new Date(lastRunMs).toISOString(),
            cooldownEndsAt: new Date(endsAtMs).toISOString(),
            remainingMs,
            elapsedMs: nowMs - lastRunMs,
        },
    }

    if (active) {
        return {
            ...base,
            outcome: 'delayed',
            reasonCode: 'COOLDOWN_ACTIVE',
            reason: `Cooldown active: ${(remainingMs / MS_PER_HOUR).toFixed(1)} hours remaining`,
        }
    }

    return {
        ...base,
        outcome: 'allowed',
        reasonCode: 'COOLDOWN_EXPIRED',
        reason: 'Cooldown expired',
    }
}

interface CooldownClaim {
    token: string
    claimedAtMs: number
    source: string
}

export interface CooldownClaimResult extends CooldownDecision {
    claimed: boolean
    /** Present when `claimed` is true: pass to `release()` if the work is abandoned. */
    claimToken?: string
    /** Present when `claimed` is true: the recorded last-run time for this execution. */
    recordedLastRunAt?: string
}

let claimCounter = 0

/**
 * In-process cooldown gate.
 *
 * Several requests can evaluate the cooldown in the same instant (e.g. a
 * scheduled cycle and a forced check both reaching a portfolio right as the
 * cooldown expires). Because each of them reads the same persisted
 * `lastRebalance`, a plain check lets all of them through. The gate records
 * the winning claim synchronously, so exactly one request is permitted per
 * cooldown window; the others see `COOLDOWN_ALREADY_CLAIMED` together with
 * the winner's recorded last-run time.
 *
 * The effective last run is the later of the persisted value and the latest
 * claim, so the claim keeps protecting the window until persistence catches up.
 */
export class CooldownGate {
    private claims = new Map<string, CooldownClaim>()

    tryClaim(input: CooldownDecisionInput & { portfolioId: string }): CooldownClaimResult {
        const nowMs = input.nowMs ?? Date.now()
        const persistedMs = parseTimestampMs(input.lastRebalance)
        const existing = this.claims.get(input.portfolioId)
        const claimWins = existing !== undefined && (persistedMs === undefined || existing.claimedAtMs > persistedMs)
        const effectiveLastRun = claimWins ? existing!.claimedAtMs : input.lastRebalance

        const decision = evaluateCooldown({ ...input, lastRebalance: effectiveLastRun, nowMs })

        if (decision.outcome !== 'allowed') {
            if (claimWins) {
                return {
                    ...decision,
                    claimed: false,
                    reasonCode: 'COOLDOWN_ALREADY_CLAIMED',
                    reason: `Another request already claimed this cooldown window at ${new Date(existing!.claimedAtMs).toISOString()}`,
                    context: {
                        ...decision.context,
                        claimedBySource: existing!.source,
                        persistedLastRunAt: persistedMs !== undefined ? new Date(persistedMs).toISOString() : undefined,
                    },
                }
            }
            return { ...decision, claimed: false }
        }

        const token = `${input.portfolioId}:${nowMs}:${++claimCounter}`
        this.claims.set(input.portfolioId, { token, claimedAtMs: nowMs, source: input.source })
        const recordedLastRunAt = new Date(nowMs).toISOString()
        return {
            ...decision,
            claimed: true,
            claimToken: token,
            recordedLastRunAt,
            context: { ...decision.context, recordedLastRunAt },
        }
    }

    /** Drop a claim when the claimed work was abandoned before it ran. */
    release(portfolioId: string, token: string | undefined): boolean {
        if (!token) return false
        const existing = this.claims.get(portfolioId)
        if (!existing || existing.token !== token) return false
        this.claims.delete(portfolioId)
        return true
    }

    getClaim(portfolioId: string): { claimedAt: string; source: string } | undefined {
        const c = this.claims.get(portfolioId)
        return c ? { claimedAt: new Date(c.claimedAtMs).toISOString(), source: c.source } : undefined
    }

    reset(): void {
        this.claims.clear()
    }
}

export const cooldownGate = new CooldownGate()

// ─────────────────────────────────────────────────────────────────────────────
// Concentration limit: partial fills
// ─────────────────────────────────────────────────────────────────────────────

/** Matches CircuitBreakers.checkConcentrationRisk (80% of portfolio value). */
export const DEFAULT_CONCENTRATION_CAP_PCT = 80

/**
 * Bound on how many consecutive evaluations may observe the same
 * partial-fill over-cap state before the guardrail stops retrying and
 * reports an explicit block. The evaluation itself is read-only, so
 * retries never duplicate side effects.
 */
export const DEFAULT_MAX_PARTIAL_FILL_OBSERVATIONS = 3

export interface PartialFillConcentrationInput {
    portfolioId?: string
    source: string
    /** USD value per asset after the fills observed so far. */
    holdingsUsd: Record<string, number>
    /** Number of trade legs planned for this rebalance. */
    plannedLegs: number
    /** Number of trade legs that actually filled. */
    filledLegs: number
    capPct?: number
    /**
     * Consecutive evaluations that have observed this partial-fill over-cap
     * state (caller-maintained). Once it reaches `maxPartialFillObservations`
     * the outcome becomes `blocked` instead of `delayed`.
     */
    partialFillObservations?: number
    maxPartialFillObservations?: number
    nowMs?: number
}

/**
 * Evaluate the concentration cap against post-fill holdings.
 *
 *  - within cap                         → `allowed`
 *  - over cap, legs still pending       → `delayed` (CONCENTRATION_PARTIAL_FILL_OVER_CAP):
 *                                         completing or retrying the remaining
 *                                         legs is expected to bring the weight back.
 *  - over cap, every leg filled         → `blocked` (CONCENTRATION_OVER_CAP):
 *                                         waiting will not fix it.
 */
export function evaluatePartialFillConcentration(input: PartialFillConcentrationInput): GuardrailOutcome {
    const nowMs = input.nowMs ?? Date.now()
    const capPct = input.capPct ?? DEFAULT_CONCENTRATION_CAP_PCT
    const entries = Object.entries(input.holdingsUsd ?? {}).filter(([, v]) => Number.isFinite(v) && v > 0)
    const totalValueUsd = entries.reduce((s, [, v]) => s + v, 0)
    const plannedLegs = Math.max(0, Math.floor(input.plannedLegs))
    const filledLegs = Math.min(plannedLegs, Math.max(0, Math.floor(input.filledLegs)))
    const pendingLegs = plannedLegs - filledLegs
    const isPartialFill = pendingLegs > 0

    let topAsset: string | null = null
    let topWeightPct = 0
    for (const [asset, value] of entries) {
        const pct = totalValueUsd > 0 ? (value / totalValueUsd) * 100 : 0
        if (pct > topWeightPct) {
            topWeightPct = pct
            topAsset = asset
        }
    }

    const context = {
        asset: topAsset,
        weightPct: Number(topWeightPct.toFixed(4)),
        capPct,
        overByPct: Number(Math.max(0, topWeightPct - capPct).toFixed(4)),
        totalValueUsd: Number(totalValueUsd.toFixed(2)),
        assetCount: entries.length,
        plannedLegs,
        filledLegs,
        pendingLegs,
        partialFill: isPartialFill,
    }
    const base = {
        guardrail: 'concentration_limit' as const,
        source: input.source,
        portfolioId: input.portfolioId,
        evaluatedAt: new Date(nowMs).toISOString(),
        context,
    }

    if (topWeightPct <= capPct) {
        return { ...base, outcome: 'allowed', reasonCode: 'CONCENTRATION_WITHIN_CAP', reason: 'All assets within concentration cap' }
    }

    if (isPartialFill) {
        const observations = Math.max(0, Math.floor(input.partialFillObservations ?? 0))
        const maxObservations = Math.max(1, Math.floor(input.maxPartialFillObservations ?? DEFAULT_MAX_PARTIAL_FILL_OBSERVATIONS))
        if (observations >= maxObservations) {
            return {
                ...base,
                outcome: 'blocked',
                reasonCode: 'CONCENTRATION_PARTIAL_FILL_STUCK',
                reason: `Partial fill (${filledLegs}/${plannedLegs} legs) left ${topAsset} at ${topWeightPct.toFixed(1)}%, over the ${capPct}% cap, for ${observations} consecutive evaluations; explicit stop`,
                context: {
                    ...context,
                    partialFillObservations: observations,
                    maxPartialFillObservations: maxObservations,
                },
            }
        }
        return {
            ...base,
            outcome: 'delayed',
            reasonCode: 'CONCENTRATION_PARTIAL_FILL_OVER_CAP',
            reason: `Partial fill (${filledLegs}/${plannedLegs} legs) left ${topAsset} at ${topWeightPct.toFixed(1)}%, over the ${capPct}% cap; remaining legs pending`,
        }
    }

    return {
        ...base,
        outcome: 'blocked',
        reasonCode: 'CONCENTRATION_OVER_CAP',
        reason: `${topAsset} at ${topWeightPct.toFixed(1)}% exceeds the ${capPct}% cap after all legs filled`,
    }
}
