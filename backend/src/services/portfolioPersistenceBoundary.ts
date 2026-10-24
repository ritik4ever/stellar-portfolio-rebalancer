/**
 * SPR-2026-156 — Service Boundary Handling for Portfolio Persistence
 *
 * Implements deterministic boundary handling for allocation edits during the
 * portfolio rebalancing lifecycle. Documents committed portfolio version and
 * execution state with a stable result across all paths (active rebalance,
 * stale CAS version conflict, and clean sequential commits).
 */

import type {
    Portfolio,
    RebalanceExecutionState,
    AllocationEditResultCode,
    AllocationEditDecision,
} from '../types/index.js'
import { ConflictError } from '../types/index.js'
import { logger } from '../utils/logger.js'
import { isDbConfigured, query } from '../db/client.js'

function stringHash32(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i)
        hash |= 0
    }
    return hash
}

// ── In-Memory Active Rebalance Tracker ─────────────────────────────────────────

interface ActiveRebalanceEntry {
    portfolioId: string
    startedAt: string
    versionAtStart?: number
    trigger?: string
}

const activeRebalances = new Map<string, ActiveRebalanceEntry>()
const recentRebalanceOutcomes = new Map<string, { status: 'completed' | 'failed'; timestamp: number; version?: number }>()

const RECENT_OUTCOME_TTL_MS = 60_000 // 1 minute window to retain outcome context

/**
 * Mark a portfolio as actively executing a rebalance.
 */
export function markRebalanceActive(
    portfolioId: string,
    metadata?: { version?: number; trigger?: string },
): void {
    activeRebalances.set(portfolioId, {
        portfolioId,
        startedAt: new Date().toISOString(),
        versionAtStart: metadata?.version,
        trigger: metadata?.trigger,
    })
    logger.debug?.('[PERSISTENCE_BOUNDARY] Marked rebalance active', { portfolioId, metadata })
}

/**
 * Mark a portfolio rebalance as finished (completed or failed).
 */
export function markRebalanceInactive(
    portfolioId: string,
    outcome?: { status: 'completed' | 'failed'; version?: number },
): void {
    activeRebalances.delete(portfolioId)
    if (outcome) {
        recentRebalanceOutcomes.set(portfolioId, {
            status: outcome.status,
            timestamp: Date.now(),
            version: outcome.version,
        })
    }
    logger.debug?.('[PERSISTENCE_BOUNDARY] Marked rebalance inactive', { portfolioId, outcome })
}

/**
 * Reset all in-memory rebalance tracking state (for isolated unit tests).
 */
export function resetRebalanceStateTracker(): void {
    activeRebalances.clear()
    recentRebalanceOutcomes.clear()
}

/**
 * Checks if a PostgreSQL advisory lock is currently held for the portfolio
 * without acquiring or mutating the lock.
 */
async function isAdvisoryLockHeld(portfolioId: string): Promise<boolean> {
    if (!isDbConfigured()) return false
    try {
        const key = stringHash32(portfolioId)
        // Inspect pg_locks to see if another backend session currently holds this advisory lock
        const res = await query<{ is_held: boolean }>(
            `SELECT EXISTS (
                SELECT 1 FROM pg_locks
                WHERE locktype = 'advisory' AND objid = $1 AND granted = true
            ) AS is_held`,
            [key]
        )
        return res.rows[0]?.is_held === true
    } catch {
        return false
    }
}

/**
 * Determine the current rebalance execution state for a given portfolio.
 * Evaluates:
 * 1. Active in-memory tracker (fast path)
 * 2. Database advisory lock status (if DB configured)
 * 3. Recent rebalance history outcome (if recently transitioned)
 */
export async function getRebalanceExecutionState(portfolioId: string): Promise<RebalanceExecutionState> {
    // 1. In-flight active rebalance tracker
    if (activeRebalances.has(portfolioId)) {
        return 'rebalancing'
    }

    // 2. Advisory lock check
    const lockHeld = await isAdvisoryLockHeld(portfolioId)
    if (lockHeld) {
        return 'rebalancing'
    }

    // 3. Recent outcome check
    const recent = recentRebalanceOutcomes.get(portfolioId)
    if (recent && Date.now() - recent.timestamp < RECENT_OUTCOME_TTL_MS) {
        return recent.status === 'completed' ? 'completed' : 'failed'
    }

    return 'idle'
}

/**
 * Check whether a portfolio is currently actively rebalancing.
 */
export async function isRebalanceActive(portfolioId: string): Promise<boolean> {
    const state = await getRebalanceExecutionState(portfolioId)
    return state === 'rebalancing'
}

/**
 * Synchronous check for active in-memory rebalance state (used by synchronous SQLite engines).
 */
export function isRebalanceActiveSync(portfolioId: string): boolean {
    return activeRebalances.has(portfolioId)
}

// ── Allocation Validation ─────────────────────────────────────────────────────

const MAX_ASSETS = 10

function validateAllocationWeights(allocations: Record<string, number>): { valid: boolean; reason?: string } {
    if (!allocations || typeof allocations !== 'object') {
        return { valid: false, reason: 'Allocations must be a valid key-value object' }
    }
    const entries = Object.entries(allocations)
    if (entries.length === 0) {
        return { valid: false, reason: 'Allocations must contain at least 1 asset' }
    }
    if (entries.length > MAX_ASSETS) {
        return { valid: false, reason: `Allocations cannot exceed ${MAX_ASSETS} assets` }
    }

    let sum = 0
    for (const [asset, weight] of entries) {
        if (typeof weight !== 'number' || isNaN(weight) || !Number.isFinite(weight)) {
            return { valid: false, reason: `Asset ${asset} has invalid weight ${weight}` }
        }
        if (weight < 0 || weight > 100) {
            return { valid: false, reason: `Asset ${asset} weight must be between 0 and 100` }
        }
        sum += weight
    }

    if (Math.abs(sum - 100) > 0.01) {
        return { valid: false, reason: `Allocations must sum to 100% (currently ${sum.toFixed(2)}%)` }
    }

    return { valid: true }
}

// ── Service Boundary Allocation Edit ──────────────────────────────────────────

export interface ApplyAllocationEditParams {
    portfolioId: string
    allocations: Record<string, number>
    expectedVersion?: number
    storage?: {
        getPortfolio(id: string): Promise<Portfolio | undefined>
        updatePortfolio(id: string, updates: Partial<Portfolio>, expectedVersion?: number): Promise<boolean>
    }
}

/**
 * Specify and implement an allocation edit during rebalance at the service boundary.
 *
 * Acceptance criteria:
 * - Documents committed portfolio version and execution state with a stable result.
 * - If rebalance is active: returns conflict_rebalancing with committedVersion and executionState='rebalancing'.
 * - If expectedVersion is stale (e.g. rebalance committed an advance): returns conflict_version with committedVersion and executionState='completed'|'idle'.
 * - If valid and idle: atomically commits edit, bumps version, and returns committed with executionState='idle'.
 */
export async function applyAllocationEdit(params: ApplyAllocationEditParams): Promise<AllocationEditDecision> {
    const { portfolioId, allocations, expectedVersion } = params

    // Lazily resolve storage dependency if not injected
    const storage = params.storage ?? (await import('./portfolioStorage.js')).portfolioStorage

    // 1. Fetch current portfolio
    const currentPortfolio = await storage.getPortfolio(portfolioId)
    if (!currentPortfolio) {
        return {
            result: 'not_found',
            applied: false,
            committedVersion: -1,
            executionState: 'idle',
            reason: `Portfolio ${portfolioId} not found`,
        }
    }

    const currentVersion = currentPortfolio.version ?? 1

    // 2. Inspect rebalance execution state at the service boundary
    const executionState = await getRebalanceExecutionState(portfolioId)

    // Boundary rule: If rebalancing is actively in flight, reject the edit to preserve invariant
    if (executionState === 'rebalancing') {
        logger.warn?.('[PERSISTENCE_BOUNDARY] Allocation edit rejected: rebalance active', {
            portfolioId,
            currentVersion,
            expectedVersion,
            executionState,
        })
        return {
            result: 'conflict_rebalancing',
            applied: false,
            committedVersion: currentVersion,
            executionState: 'rebalancing',
            reason: `Cannot edit allocations: portfolio ${portfolioId} is actively rebalancing`,
            portfolio: currentPortfolio,
        }
    }

    // 3. Verify optimistic concurrency control (CAS)
    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
        logger.warn?.('[PERSISTENCE_BOUNDARY] Allocation edit rejected: stale version', {
            portfolioId,
            currentVersion,
            expectedVersion,
            executionState,
        })
        return {
            result: 'conflict_version',
            applied: false,
            committedVersion: currentVersion,
            executionState: executionState === 'completed' ? 'completed' : 'idle',
            reason: `Portfolio version conflict: expected version ${expectedVersion}, but committed version is ${currentVersion}`,
            portfolio: currentPortfolio,
        }
    }

    // 4. Validate allocation rules
    const validation = validateAllocationWeights(allocations)
    if (!validation.valid) {
        return {
            result: 'validation_error',
            applied: false,
            committedVersion: currentVersion,
            executionState: 'idle',
            reason: validation.reason ?? 'Invalid allocation weights',
            portfolio: currentPortfolio,
        }
    }

    // 5. Apply the update atomically
    try {
        const updateOk = await storage.updatePortfolio(
            portfolioId,
            { allocations },
            expectedVersion ?? currentVersion,
        )

        if (!updateOk) {
            const recheck = await storage.getPortfolio(portfolioId)
            const latestVer = recheck?.version ?? currentVersion
            return {
                result: 'conflict_version',
                applied: false,
                committedVersion: latestVer,
                executionState: 'idle',
                reason: `Failed to commit allocation update against version ${expectedVersion ?? currentVersion}`,
                portfolio: recheck ?? currentPortfolio,
            }
        }

        const updatedPortfolio = await storage.getPortfolio(portfolioId)
        const nextVersion = updatedPortfolio?.version ?? (currentVersion + 1)

        logger.info?.('[PERSISTENCE_BOUNDARY] Allocation edit committed successfully', {
            portfolioId,
            previousVersion: currentVersion,
            committedVersion: nextVersion,
        })

        return {
            result: 'committed',
            applied: true,
            committedVersion: nextVersion,
            executionState: 'idle',
            reason: 'Allocation edit successfully committed',
            portfolio: updatedPortfolio ?? { ...currentPortfolio, allocations, version: nextVersion },
        }
    } catch (err) {
        if (err instanceof ConflictError) {
            const recheck = await storage.getPortfolio(portfolioId)
            const latestVer = err.currentVersion ?? recheck?.version ?? currentVersion
            return {
                result: 'conflict_version',
                applied: false,
                committedVersion: latestVer,
                executionState: err.executionState ?? 'idle',
                reason: err.message,
                portfolio: recheck ?? currentPortfolio,
            }
        }
        throw err
    }
}
