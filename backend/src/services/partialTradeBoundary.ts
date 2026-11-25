/**
 * SPR-2026-126, SPR-2026-127, SPR-2026-128, SPR-2026-129
 * Service Boundary Handling for Partial Trade Handling in Portfolio Rebalancing.
 *
 * Implements:
 * 1. [API] Boundary handling for one fill in a multi-asset rebalance documenting
 *    actual post-trade weights and residual work with a stable result.
 * 2. [RELIABILITY] Safe recovery in partial trade handling: exercise later trade failing
 *    after earlier fill with bounded retry or explicit stop behavior, guaranteeing
 *    retries cannot duplicate side effects and failure remains diagnosable.
 * 3. [DATA] Preserves state consistency during concurrent and interrupted work,
 *    ensuring persisted records and externally visible results agree.
 * 4. [OBS] Surfaces actionable outcomes allowing operators to distinguish success,
 *    delay, and blocked work with sanitized context without exposing secrets.
 */

import { Dec } from '../utils/decimal.js'
import { logger } from '../utils/logger.js'
import { redactString } from '../utils/secretRedactor.js'
import {
    recordPartialTradeOutcome,
    type PartialTradeObservabilityOutcome
} from '../observability/metrics.js'
import type { RebalanceEvent } from './rebalanceHistory.js'
import { rebalanceHistoryService } from './serviceContainer.js'
import { acquireWorkerLock, releaseWorkerLock } from '../queue/workers/workerRuntime.js'
import { markRebalanceActive, markRebalanceInactive } from './portfolioPersistenceBoundary.js'

export type PartialTradeStatus = 'executed' | 'partial' | 'failed' | 'skipped'
export type PartialRebalanceResult = 'success' | 'partial' | 'failed' | 'conflict'
export type PartialTradeFailureAction = 'stop' | 'retry'

export interface PartialTradeLeg {
    tradeId: string
    fromAsset: string
    toAsset: string
    requestedAmount: number
    executedAmount: number
    remainingAmount: number
    status: PartialTradeStatus
    sideEffectApplied: boolean
    referencePrice?: number
    estimatedReceivedAmount?: number
    txHash?: string
    failureReason?: string
    errorCode?: string
    retriesAttempted?: number
}

export interface ResidualWorkDetails {
    hasResidualWork: boolean
    remainingTrades: Array<{
        tradeId: string
        fromAsset: string
        toAsset: string
        remainingAmount: number
        estimatedValueUsd?: number
    }>
    assetDrift: Record<string, {
        currentBalance: number
        currentWeightPercent: number
        targetWeightPercent: number
        driftPercent: number
        residualValueUsd?: number
    }>
    totalResidualValueUsd: number
    pendingTradesCount: number
}

export interface PartialTradeRetryOutcome {
    attempt: number
    maxAttempts: number
    retriesRemaining: number
    retryScheduled: boolean
    action: PartialTradeFailureAction
    reason?: string
}

export interface PartialTradeObservabilityContext {
    source: string
    outcome: PartialTradeObservabilityOutcome
    reasonCode: string
    sanitizedDiagnostics?: string
}

export interface PartialTradeExecutionDecision {
    result: PartialRebalanceResult
    status: 'completed' | 'partial' | 'failed'
    portfolioId: string
    executedTradesCount: number
    failedTradesCount: number
    totalTradesCount: number
    postTradeBalances: Record<string, number>
    postTradeWeights: Record<string, number>
    targetWeights: Record<string, number>
    residualWork: ResidualWorkDetails
    trades: PartialTradeLeg[]
    actionTaken: PartialTradeFailureAction
    retryOutcome?: PartialTradeRetryOutcome
    observability: PartialTradeObservabilityContext
    failureReason?: string
}

export interface EvaluatePartialTradeParams {
    portfolioId: string
    initialBalances: Record<string, number>
    targetAllocations: Record<string, number>
    prices: Record<string, { price: number } | number>
    trades: PartialTradeLeg[]
    attempt?: number
    maxAttempts?: number
    stopOnFailure?: boolean
    source?: string
    failureReason?: string
    isRetryable?: boolean
}

/**
 * Extracts numeric price from a price record or number.
 */
export function extractPrice(val: { price: number } | number | undefined): number {
    if (val === undefined || val === null) return 0
    if (typeof val === 'number') return val
    if (typeof val === 'object' && typeof val.price === 'number') return val.price
    return 0
}

/**
 * Sanitizes an error message or diagnostic detail, redacting private keys, tokens,
 * passwords and secrets.
 */
export function sanitizeDiagnostics(message: string | undefined): string | undefined {
    if (!message) return undefined
    let sanitized = redactString(message)
    // Additional defense-in-depth sanitization for Stellar private keys, seeds, and credentials
    sanitized = sanitized
        .replace(/S[A-Z0-9]{55}/g, '[REDACTED]')
        .replace(/\b(?:password|passwd|pwd|secret_key|private_key)\s*(?:=|:|\s+)\s*(?:"[^"]*"|'[^']*'|\S+)/gi, (match) => {
            const prefix = match.split(/[:=\s]/)[0]
            return `${prefix}: [REDACTED]`
        })
    return sanitized.length > 300 ? `${sanitized.slice(0, 300)}...` : sanitized
}

/**
 * Calculates actual portfolio weights given current balances and prices.
 * Returns normalized percentages that sum to 100.
 */
export function calculateActualWeights(
    balances: Record<string, number>,
    prices: Record<string, { price: number } | number>
): { totalValue: number; assetValues: Record<string, number>; weights: Record<string, number> } {
    const assetSymbols = Object.keys(balances).sort()
    const assetValues: Record<string, number> = {}
    let totalValue = 0

    for (const asset of assetSymbols) {
        const balance = balances[asset] ?? 0
        const price = extractPrice(prices[asset])
        const value = Dec.mul(balance, price)
        assetValues[asset] = value
        totalValue = Dec.add(totalValue, value)
    }

    const weights: Record<string, number> = {}
    if (totalValue <= 0) {
        for (const asset of assetSymbols) {
            weights[asset] = 0
        }
        return { totalValue: 0, assetValues, weights }
    }

    for (const asset of assetSymbols) {
        weights[asset] = Dec.percentage(assetValues[asset], totalValue)
    }

    return { totalValue, assetValues, weights }
}

/**
 * Derives updated asset balances after executing trade legs.
 */
export function calculatePostTradeBalances(
    initialBalances: Record<string, number>,
    trades: PartialTradeLeg[],
    prices: Record<string, { price: number } | number> = {}
): Record<string, number> {
    const postBalances: Record<string, number> = { ...initialBalances }

    for (const trade of trades) {
        if (!trade.executedAmount || trade.executedAmount <= 0) {
            continue
        }

        const fromBalance = postBalances[trade.fromAsset] ?? 0
        postBalances[trade.fromAsset] = Math.max(0, Dec.sub(fromBalance, trade.executedAmount))

        let received = trade.estimatedReceivedAmount
        if (received === undefined || received === null || received <= 0) {
            const fromPrice = extractPrice(prices[trade.fromAsset]) || 1
            const toPrice = extractPrice(prices[trade.toAsset]) || 1
            const ratio = toPrice > 0 ? fromPrice / toPrice : 1
            received = Dec.mul(trade.executedAmount, ratio)
        }

        const toBalance = postBalances[trade.toAsset] ?? 0
        postBalances[trade.toAsset] = Dec.add(toBalance, received)
    }

    return postBalances
}

/**
 * Calculates residual work and remaining asset drift relative to target allocations.
 */
export function calculateResidualWork(
    postTradeBalances: Record<string, number>,
    targetAllocations: Record<string, number>,
    prices: Record<string, { price: number } | number>,
    trades: PartialTradeLeg[]
): ResidualWorkDetails {
    const allAssets = Array.from(new Set([
        ...Object.keys(postTradeBalances),
        ...Object.keys(targetAllocations)
    ])).sort()

    const { totalValue, weights: actualWeights } = calculateActualWeights(postTradeBalances, prices)

    const remainingTrades: ResidualWorkDetails['remainingTrades'] = []
    let totalResidualValueUsd = 0

    for (const trade of trades) {
        const remaining = trade.remainingAmount > 0
            ? trade.remainingAmount
            : trade.status === 'failed' || trade.status === 'skipped'
                ? Math.max(0, Dec.sub(trade.requestedAmount, trade.executedAmount || 0))
                : 0

        if (remaining > 0) {
            const price = extractPrice(prices[trade.fromAsset])
            const estimatedValueUsd = Dec.mul(remaining, price)
            remainingTrades.push({
                tradeId: trade.tradeId,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                remainingAmount: remaining,
                estimatedValueUsd: estimatedValueUsd > 0 ? estimatedValueUsd : undefined
            })
            totalResidualValueUsd = Dec.add(totalResidualValueUsd, estimatedValueUsd)
        }
    }

    const assetDrift: ResidualWorkDetails['assetDrift'] = {}
    let hasSignificantDrift = false

    for (const asset of allAssets) {
        const currentBalance = postTradeBalances[asset] ?? 0
        const currentWeightPercent = actualWeights[asset] ?? 0
        const targetWeightPercent = targetAllocations[asset] ?? 0
        const driftPercent = Dec.sub(currentWeightPercent, targetWeightPercent)

        if (Math.abs(driftPercent) > 0.05) {
            hasSignificantDrift = true
        }

        const price = extractPrice(prices[asset])
        const targetValue = Dec.targetValue(totalValue, targetWeightPercent)
        const currentValue = Dec.mul(currentBalance, price)
        const residualValueUsd = Math.abs(Dec.sub(targetValue, currentValue))

        assetDrift[asset] = {
            currentBalance,
            currentWeightPercent,
            targetWeightPercent,
            driftPercent,
            residualValueUsd: residualValueUsd > 0 ? residualValueUsd : undefined
        }
    }

    const hasResidualWork = remainingTrades.length > 0 || hasSignificantDrift

    return {
        hasResidualWork,
        remainingTrades,
        assetDrift,
        totalResidualValueUsd,
        pendingTradesCount: remainingTrades.length
    }
}

/**
 * Core decision engine specifying boundary handling for Partial Trade Handling.
 * Satisfies Acceptance Criteria for SPR-2026-126, 127, 128, 129.
 */
export function evaluatePartialTradeDecision(params: EvaluatePartialTradeParams): PartialTradeExecutionDecision {
    const {
        portfolioId,
        initialBalances,
        targetAllocations,
        prices,
        trades,
        attempt = 1,
        maxAttempts = 3,
        stopOnFailure = false,
        source = 'service',
        failureReason,
        isRetryable = false
    } = params

    const postTradeBalances = calculatePostTradeBalances(initialBalances, trades, prices)
    const { weights: postTradeWeights } = calculateActualWeights(postTradeBalances, prices)
    const residualWork = calculateResidualWork(postTradeBalances, targetAllocations, prices, trades)

    const executedTradesCount = trades.filter(t => t.status === 'executed' || t.executedAmount > 0).length
    const failedTradesCount = trades.filter(t => t.status === 'failed').length
    const totalTradesCount = trades.length

    const allTradesSucceeded = totalTradesCount > 0 && trades.every(
        t => t.status === 'executed' && (!t.remainingAmount || t.remainingAmount <= 0)
    ) && !residualWork.hasResidualWork

    const anyTradeFilled = trades.some(t => (t.executedAmount || 0) > 0)

    let result: PartialRebalanceResult
    let status: 'completed' | 'partial' | 'failed'
    let outcome: PartialTradeObservabilityOutcome
    let reasonCode: string
    let actionTaken: PartialTradeFailureAction
    let retryScheduled = false

    if (allTradesSucceeded) {
        result = 'success'
        status = 'completed'
        outcome = 'success'
        reasonCode = 'rebalance_success'
        actionTaken = 'stop'
    } else if (anyTradeFilled) {
        result = 'partial'
        status = 'partial'

        const canRetry = isRetryable && attempt < maxAttempts && !stopOnFailure
        if (canRetry) {
            actionTaken = 'retry'
            outcome = 'delay'
            reasonCode = 'partial_trade_retry_scheduled'
            retryScheduled = true
        } else {
            actionTaken = 'stop'
            outcome = 'blocked'
            reasonCode = stopOnFailure
                ? 'partial_trade_explicit_stop'
                : attempt >= maxAttempts
                    ? 'partial_trade_retry_exhausted'
                    : 'partial_trade_permanent_failure'
        }
    } else {
        result = 'failed'
        status = 'failed'

        const canRetry = isRetryable && attempt < maxAttempts && !stopOnFailure
        if (canRetry) {
            actionTaken = 'retry'
            outcome = 'delay'
            reasonCode = 'trade_failure_retry_scheduled'
            retryScheduled = true
        } else {
            actionTaken = 'stop'
            outcome = 'blocked'
            reasonCode = 'trade_failure_permanent'
        }
    }

    const retriesRemaining = retryScheduled ? Math.max(0, maxAttempts - attempt) : 0
    const retryOutcome: PartialTradeRetryOutcome = {
        attempt,
        maxAttempts,
        retriesRemaining,
        retryScheduled,
        action: actionTaken,
        reason: retryScheduled
            ? `Retry scheduled for residual trades (attempt ${attempt + 1} of ${maxAttempts})`
            : (failureReason || reasonCode)
    }

    const sanitizedDiagnostics = sanitizeDiagnostics(failureReason)

    const decision: PartialTradeExecutionDecision = {
        result,
        status,
        portfolioId,
        executedTradesCount,
        failedTradesCount,
        totalTradesCount,
        postTradeBalances,
        postTradeWeights,
        targetWeights: { ...targetAllocations },
        residualWork,
        trades,
        actionTaken,
        retryOutcome,
        observability: {
            source,
            outcome,
            reasonCode,
            sanitizedDiagnostics
        },
        failureReason: sanitizedDiagnostics
    }

    recordPartialTradeOutcome({
        source,
        outcome,
        reasonCode
    })

    logger.info('[PARTIAL_TRADE] Evaluated boundary decision', {
        portfolioId,
        source,
        result,
        status,
        outcome,
        reasonCode,
        executedTradesCount,
        failedTradesCount,
        residualTradesCount: residualWork.pendingTradesCount,
        actionTaken
    })

    return decision
}

/**
 * Builds a safe retry plan that guarantees no duplicate side effects.
 * Excludes trades that already filled 100%, and trades only the unfilled remaining amounts.
 */
export function buildSafeRetryPlan(
    decision: PartialTradeExecutionDecision
): Array<{ tradeId: string; fromAsset: string; toAsset: string; amount: number }> {
    const retryTrades: Array<{ tradeId: string; fromAsset: string; toAsset: string; amount: number }> = []

    for (const trade of decision.trades) {
        if (trade.sideEffectApplied && (!trade.remainingAmount || trade.remainingAmount <= 0)) {
            // Already completely filled; never duplicate side effect
            continue
        }

        if (trade.sideEffectApplied && trade.remainingAmount > 0) {
            // Partially filled; retry ONLY the remaining unfilled quantity
            retryTrades.push({
                tradeId: `${trade.tradeId}-retry`,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                amount: trade.remainingAmount
            })
            continue
        }

        if (!trade.sideEffectApplied) {
            // Never executed or failed with zero fills; retry requested quantity
            retryTrades.push({
                tradeId: `${trade.tradeId}-retry`,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                amount: trade.requestedAmount
            })
        }
    }

    return retryTrades
}

/**
 * Persists the rebalance execution decision to the audit log ensuring that
 * externally visible results and persisted database records agree.
 */
export async function persistPartialTradeRecord(
    decision: PartialTradeExecutionDecision,
    metadata?: { trigger?: string; feePaid?: number; slippageBps?: number; gasUsed?: string }
): Promise<RebalanceEvent> {
    const dbStatus = decision.status === 'completed'
        ? 'completed'
        : decision.status === 'failed'
            ? 'failed'
            : 'pending' // Maps to 'partial' in rebalance history queries

    const details = {
        executionStatus: decision.status,
        result: decision.result,
        postTradeBalances: decision.postTradeBalances,
        postTradeWeights: decision.postTradeWeights,
        targetWeights: decision.targetWeights,
        residualWork: decision.residualWork,
        trades: decision.trades.map(t => ({
            tradeId: t.tradeId,
            fromAsset: t.fromAsset,
            toAsset: t.toAsset,
            requestedAmount: t.requestedAmount,
            executedAmount: t.executedAmount,
            remainingAmount: t.remainingAmount,
            status: t.status,
            sideEffectApplied: t.sideEffectApplied,
            txHash: t.txHash,
            failureReason: sanitizeDiagnostics(t.failureReason)
        })),
        retryOutcome: decision.retryOutcome,
        observability: decision.observability,
        failureReason: decision.failureReason
    }

    const event = await rebalanceHistoryService.recordRebalanceEvent({
        portfolioId: decision.portfolioId,
        trigger: metadata?.trigger || 'Rebalance Execution',
        trades: decision.executedTradesCount,
        gasUsed: metadata?.gasUsed || '0 XLM',
        feePaid: metadata?.feePaid ?? 0,
        slippageBps: metadata?.slippageBps ?? 0,
        status: dbStatus,
        isAutomatic: false,
        error: decision.failureReason,
        details
    })

    return event
}

/**
 * High-level orchestration boundary helper that handles locking, execution,
 * state consistency, safe cleanup, and agreement between response and persisted DB.
 */
export async function executeWithPartialTradeBoundary<T>(
    portfolioId: string,
    executor: () => Promise<PartialTradeExecutionDecision>
): Promise<PartialTradeExecutionDecision> {
    const lockAcquired = await acquireWorkerLock(portfolioId)
    if (!lockAcquired) {
        logger.warn('[PARTIAL_TRADE] Conflict: rebalance already in progress', { portfolioId })
        return {
            result: 'conflict',
            status: 'failed',
            portfolioId,
            executedTradesCount: 0,
            failedTradesCount: 0,
            totalTradesCount: 0,
            postTradeBalances: {},
            postTradeWeights: {},
            targetWeights: {},
            residualWork: {
                hasResidualWork: true,
                remainingTrades: [],
                assetDrift: {},
                totalResidualValueUsd: 0,
                pendingTradesCount: 0
            },
            trades: [],
            actionTaken: 'stop',
            observability: {
                source: 'service',
                outcome: 'blocked',
                reasonCode: 'conflict_rebalancing',
                sanitizedDiagnostics: 'Rebalance already in progress for this portfolio'
            },
            failureReason: 'Rebalance already in progress for this portfolio'
        }
    }

    markRebalanceActive(portfolioId, { trigger: 'partial_trade_rebalance' })

    try {
        const decision = await executor()
        await persistPartialTradeRecord(decision)
        return decision
    } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error)
        const sanitized = sanitizeDiagnostics(rawMessage)

        logger.error('[PARTIAL_TRADE] Interrupted rebalance work', {
            portfolioId,
            error: sanitized
        })

        const failedDecision: PartialTradeExecutionDecision = {
            result: 'failed',
            status: 'failed',
            portfolioId,
            executedTradesCount: 0,
            failedTradesCount: 1,
            totalTradesCount: 1,
            postTradeBalances: {},
            postTradeWeights: {},
            targetWeights: {},
            residualWork: {
                hasResidualWork: true,
                remainingTrades: [],
                assetDrift: {},
                totalResidualValueUsd: 0,
                pendingTradesCount: 0
            },
            trades: [],
            actionTaken: 'stop',
            observability: {
                source: 'service',
                outcome: 'blocked',
                reasonCode: 'interrupted_work',
                sanitizedDiagnostics: sanitized
            },
            failureReason: sanitized
        }

        try {
            await persistPartialTradeRecord(failedDecision)
        } catch (persistErr) {
            logger.error('[PARTIAL_TRADE] Failed to persist failure record during interruption', {
                portfolioId,
                error: sanitizeDiagnostics(persistErr instanceof Error ? persistErr.message : String(persistErr))
            })
        }

        return failedDecision
    } finally {
        markRebalanceInactive(portfolioId)
        await releaseWorkerLock(portfolioId)
    }
}
