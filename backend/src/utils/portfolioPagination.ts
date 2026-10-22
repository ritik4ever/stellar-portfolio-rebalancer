import { redactArgs } from './secretRedactor.js'
import { logger } from './logger.js'
import {
    recordPortfolioPaginationOutcome,
    recordPortfolioPaginationItemsChanged,
    type PaginationState,
} from '../observability/metrics.js'

export type { PaginationState }

export interface PortfolioPageCursor {
    createdAt: string
    id: string
    total?: number
}

export interface PortfolioPaginationResult<T = unknown> {
    portfolios: T[]
    limit: number
    cursor: string | null
    nextCursor: string | null
    count: number
    total: number
    itemsChanged?: boolean
    changeKind?: 'none' | 'items_inserted' | 'items_deleted' | 'count_drift'
}

/**
 * Encode a portfolio pagination cursor into a URL-safe base64 string.
 */
export function encodePortfolioCursor(cursor: PortfolioPageCursor): string {
    const payload = JSON.stringify({
        createdAt: cursor.createdAt,
        id: cursor.id,
        ...(typeof cursor.total === 'number' ? { total: cursor.total } : {}),
    })
    return Buffer.from(payload, 'utf8').toString('base64url')
}

/**
 * Decode and validate a portfolio pagination cursor.
 * Returns null if the cursor is malformed or invalid.
 */
export function decodePortfolioCursor(raw: string): PortfolioPageCursor | null {
    if (!raw || typeof raw !== 'string') return null
    const trimmed = raw.trim()
    if (!trimmed) return null

    // 1. Try base64url / base64 decoded JSON
    try {
        const decodedStr = Buffer.from(trimmed, 'base64').toString('utf8')
        if (decodedStr.startsWith('{') && decodedStr.endsWith('}')) {
            const parsed = JSON.parse(decodedStr)
            if (
                parsed &&
                typeof parsed === 'object' &&
                typeof parsed.createdAt === 'string' &&
                typeof parsed.id === 'string' &&
                parsed.id.length > 0 &&
                !Number.isNaN(Date.parse(parsed.createdAt))
            ) {
                return {
                    createdAt: new Date(parsed.createdAt).toISOString(),
                    id: parsed.id,
                    ...(typeof parsed.total === 'number' ? { total: parsed.total } : {}),
                }
            }
        }
    } catch {
        // Fall through to alternative parsing formats
    }

    // 2. Try raw JSON
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed = JSON.parse(trimmed)
            if (
                parsed &&
                typeof parsed === 'object' &&
                typeof parsed.createdAt === 'string' &&
                typeof parsed.id === 'string' &&
                parsed.id.length > 0 &&
                !Number.isNaN(Date.parse(parsed.createdAt))
            ) {
                return {
                    createdAt: new Date(parsed.createdAt).toISOString(),
                    id: parsed.id,
                    ...(typeof parsed.total === 'number' ? { total: parsed.total } : {}),
                }
            }
        } catch {
            // Fall through
        }
    }

    // 3. Try "createdAt_id" or "createdAt:id"
    const delimiter = trimmed.includes('__') ? '__' : (trimmed.includes('_') ? '_' : (trimmed.includes(':') ? ':' : null))
    if (delimiter) {
        const splitIndex = trimmed.lastIndexOf(delimiter)
        const datePart = trimmed.slice(0, splitIndex)
        const idPart = trimmed.slice(splitIndex + delimiter.length)
        if (datePart && idPart && !Number.isNaN(Date.parse(datePart))) {
            return {
                createdAt: new Date(datePart).toISOString(),
                id: idPart,
            }
        }
    }

    return null
}

/**
 * Diagnose whether items changed in the underlying dataset during pagination traversal.
 */
export function diagnosePaginationChange(params: {
    currentTotal: number
    cursor?: PortfolioPageCursor | null
}): {
    itemsChanged: boolean
    changeKind: 'none' | 'items_inserted' | 'items_deleted' | 'count_drift'
} {
    const { currentTotal, cursor } = params
    if (!cursor || typeof cursor.total !== 'number') {
        return { itemsChanged: false, changeKind: 'none' }
    }
    if (currentTotal === cursor.total) {
        return { itemsChanged: false, changeKind: 'none' }
    }
    if (currentTotal > cursor.total) {
        return { itemsChanged: true, changeKind: 'items_inserted' }
    }
    return { itemsChanged: true, changeKind: 'items_deleted' }
}

/**
 * Sanitize diagnostic context to guarantee secrets (e.g. private keys, credentials, tokens)
 * are redacted before writing to logs or emitting signals.
 */
export function sanitizePaginationContext<T extends Record<string, unknown>>(context: T): T {
    try {
        const cloned = JSON.parse(JSON.stringify(context))
        return redactArgs([cloned])[0] as T
    } catch {
        return context
    }
}

/**
 * Surface actionable Portfolio API pagination outcome signal:
 * - Records Prometheus counters partitioned by source, outcome, and state (success, delayed, blocked)
 * - Emits items_changed diagnostic counters when mutations occur during pagination
 * - Produces sanitized, structured logs with safe context (no secrets exposed)
 */
export function recordPaginationSignal(params: {
    source: string
    outcome: string
    state: PaginationState
    context: Record<string, unknown>
    durationSeconds?: number
}): void {
    const { source, outcome, state, context, durationSeconds } = params

    // 1. Prometheus metrics
    recordPortfolioPaginationOutcome({
        source,
        outcome,
        state,
        durationSeconds,
    })

    const changeKind = context.changeKind as string | undefined
    if (changeKind === 'items_inserted' || changeKind === 'items_deleted' || changeKind === 'count_drift') {
        recordPortfolioPaginationItemsChanged({
            source,
            changeKind,
        })
    }

    // 2. Structured logging
    const safeContext = sanitizePaginationContext({
        source,
        outcome,
        state,
        ...context,
    })

    if (state === 'blocked') {
        logger.warn(safeContext, 'Portfolio pagination blocked')
    } else if (state === 'delayed') {
        logger.warn(safeContext, 'Portfolio pagination delayed')
    } else {
        logger.info(safeContext, 'Portfolio pagination success')
    }
}
