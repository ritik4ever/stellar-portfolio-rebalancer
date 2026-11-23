/**
 * SPR-2026-126, SPR-2026-127, SPR-2026-128, SPR-2026-129, SPR-2026-130
 * Comprehensive test suite for Partial Trade Handling in Portfolio Rebalancing.
 *
 * Covers:
 * 1. [API] Boundary handling for one fill in multi-asset rebalance (SPR-2026-126 / closes #2050)
 * 2. [RELIABILITY] Safe recovery, bounded retries & no duplicate side effects (SPR-2026-127 / closes #2051)
 * 3. [DATA] State consistency across concurrent & interrupted work (SPR-2026-128 / closes #2052)
 * 4. [OBS] Actionable observability signals & secret redaction (SPR-2026-129 / closes #2053)
 * 5. [TEST] Deterministic edge cases with isolated doubles (SPR-2026-130)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    calculateActualWeights,
    calculatePostTradeBalances,
    calculateResidualWork,
    evaluatePartialTradeDecision,
    buildSafeRetryPlan,
    sanitizeDiagnostics,
    persistPartialTradeRecord,
    executeWithPartialTradeBoundary,
    type PartialTradeLeg
} from '../services/partialTradeBoundary.js'
import { rebalanceHistoryService } from '../services/serviceContainer.js'
import * as workerRuntime from '../queue/workers/workerRuntime.js'

describe('Partial Trade Handling Service Boundary', () => {
    const portfolioId = 'portfolio-test-partial-126'
    const prices = {
        XLM: { price: 0.1 },
        USDC: { price: 1.0 },
        BTC: { price: 20000 }
    }

    const targetAllocations = {
        XLM: 40,
        USDC: 40,
        BTC: 20
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ──────────────────────────────────────────────────────────────────────────
    // 1. SPR-2026-126 [API] Define boundary handling for Partial trade handling
    // ──────────────────────────────────────────────────────────────────────────
    describe('SPR-2026-126 [API] Boundary handling for one fill in multi-asset rebalance', () => {
        it('documents actual post-trade weights and residual work with stable result "partial" when one fill occurs', () => {
            const initialBalances = {
                XLM: 1000, // $100
                USDC: 50,  // $50
                BTC: 0     // $0
            } // Total $150

            // Multi-asset trade plan:
            // Leg 1: Sell 400 XLM for 40 USDC (Fills 100%)
            // Leg 2: Buy BTC with 30 USDC (Fails before execution)
            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 'trade-leg-1',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 400,
                    executedAmount: 400,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true,
                    estimatedReceivedAmount: 40,
                    txHash: 'tx-hash-leg-1'
                },
                {
                    tradeId: 'trade-leg-2',
                    fromAsset: 'USDC',
                    toAsset: 'BTC',
                    requestedAmount: 30,
                    executedAmount: 0,
                    remainingAmount: 30,
                    status: 'failed',
                    sideEffectApplied: false,
                    failureReason: 'Horizon RPC liquidity timeout'
                }
            ]

            const decision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades,
                attempt: 1,
                maxAttempts: 3,
                stopOnFailure: false,
                isRetryable: true,
                source: 'api'
            })

            // Acceptance Criteria:
            // 1. Stable result 'partial'
            expect(decision.result).toBe('partial')
            expect(decision.status).toBe('partial')

            // 2. Documents actual post-trade weights reflecting the executed fill
            // Initial XLM 1000 - 400 = 600 ($60)
            // Initial USDC 50 + 40 = 90 ($90)
            // Total value = $150
            // XLM weight = 60 / 150 = 40%
            // USDC weight = 90 / 150 = 60%
            // BTC weight = 0%
            expect(decision.postTradeBalances.XLM).toBe(600)
            expect(decision.postTradeBalances.USDC).toBe(90)
            expect(decision.postTradeBalances.BTC).toBe(0)
            expect(decision.postTradeWeights.XLM).toBe(40)
            expect(decision.postTradeWeights.USDC).toBe(60)
            expect(decision.postTradeWeights.BTC).toBe(0)

            // 3. Documents residual work
            expect(decision.residualWork.hasResidualWork).toBe(true)
            expect(decision.residualWork.pendingTradesCount).toBe(1)
            expect(decision.residualWork.remainingTrades).toHaveLength(1)
            expect(decision.residualWork.remainingTrades[0]).toEqual({
                tradeId: 'trade-leg-2',
                fromAsset: 'USDC',
                toAsset: 'BTC',
                remainingAmount: 30,
                estimatedValueUsd: 30
            })
            expect(decision.residualWork.totalResidualValueUsd).toBe(30)

            // 4. Counts agree
            expect(decision.executedTradesCount).toBe(1)
            expect(decision.failedTradesCount).toBe(1)
            expect(decision.totalTradesCount).toBe(2)
        })

        it('returns stable result "success" with zero residual work when all fills complete', () => {
            const initialBalances = { XLM: 1000, USDC: 50, BTC: 0 }
            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 'trade-1',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 400,
                    executedAmount: 400,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true,
                    estimatedReceivedAmount: 40
                },
                {
                    tradeId: 'trade-2',
                    fromAsset: 'USDC',
                    toAsset: 'BTC',
                    requestedAmount: 30,
                    executedAmount: 30,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true,
                    estimatedReceivedAmount: 0.0015
                }
            ]

            const decision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations: { XLM: 40, USDC: 40, BTC: 20 },
                prices,
                trades,
                attempt: 1,
                maxAttempts: 3
            })

            expect(decision.result).toBe('success')
            expect(decision.status).toBe('completed')
            expect(decision.executedTradesCount).toBe(2)
            expect(decision.failedTradesCount).toBe(0)
            expect(decision.residualWork.hasResidualWork).toBe(false)
            expect(decision.residualWork.remainingTrades).toHaveLength(0)
        })

        it('returns stable result "failed" when zero fills execute', () => {
            const initialBalances = { XLM: 1000, USDC: 50, BTC: 0 }
            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 'trade-1',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 400,
                    executedAmount: 0,
                    remainingAmount: 400,
                    status: 'failed',
                    sideEffectApplied: false,
                    failureReason: 'Orderbook empty'
                }
            ]

            const decision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades
            })

            expect(decision.result).toBe('failed')
            expect(decision.status).toBe('failed')
            expect(decision.executedTradesCount).toBe(0)
            expect(decision.failedTradesCount).toBe(1)
        })
    })

    // ──────────────────────────────────────────────────────────────────────────
    // 2. SPR-2026-127 [RELIABILITY] Recover safely in Partial trade handling
    // ──────────────────────────────────────────────────────────────────────────
    describe('SPR-2026-127 [RELIABILITY] Bounded retries and no duplicate side effects', () => {
        it('schedules bounded retry for retryable failure when retry budget is available', () => {
            const initialBalances = { XLM: 1000, USDC: 50 }
            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 'leg-1',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 500,
                    executedAmount: 500,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true
                },
                {
                    tradeId: 'leg-2',
                    fromAsset: 'USDC',
                    toAsset: 'BTC',
                    requestedAmount: 25,
                    executedAmount: 0,
                    remainingAmount: 25,
                    status: 'failed',
                    sideEffectApplied: false,
                    failureReason: 'Network connection timeout'
                }
            ]

            const decision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades,
                attempt: 1,
                maxAttempts: 3,
                isRetryable: true,
                stopOnFailure: false
            })

            expect(decision.actionTaken).toBe('retry')
            expect(decision.retryOutcome?.retryScheduled).toBe(true)
            expect(decision.retryOutcome?.attempt).toBe(1)
            expect(decision.retryOutcome?.maxAttempts).toBe(3)
            expect(decision.retryOutcome?.retriesRemaining).toBe(2)
            expect(decision.observability.outcome).toBe('delay')
        })

        it('guarantees retries CANNOT duplicate side effects by excluding fully executed legs', () => {
            const initialBalances = { XLM: 1000, USDC: 50 }
            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 'leg-1-filled',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 500,
                    executedAmount: 500,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true
                },
                {
                    tradeId: 'leg-2-failed',
                    fromAsset: 'USDC',
                    toAsset: 'BTC',
                    requestedAmount: 25,
                    executedAmount: 0,
                    remainingAmount: 25,
                    status: 'failed',
                    sideEffectApplied: false
                }
            ]

            const decision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades,
                attempt: 1,
                maxAttempts: 3,
                isRetryable: true
            })

            const retryPlan = buildSafeRetryPlan(decision)

            // CRITICAL RELIABILITY INVARIANT:
            // Leg 1 already filled 500 XLM. Retrying MUST NOT execute leg 1 again!
            const leg1InPlan = retryPlan.find(r => r.tradeId.includes('leg-1-filled'))
            expect(leg1InPlan).toBeUndefined()

            // Leg 2 failed and had no side effects: it is included in the retry plan
            const leg2InPlan = retryPlan.find(r => r.tradeId.includes('leg-2-failed'))
            expect(leg2InPlan).toBeDefined()
            expect(leg2InPlan?.amount).toBe(25)
            expect(leg2InPlan?.fromAsset).toBe('USDC')
            expect(leg2InPlan?.toAsset).toBe('BTC')
        })

        it('retries only the unfilled remainder of partially filled legs', () => {
            const initialBalances = { XLM: 1000, USDC: 50 }
            // Leg 1 requested 1000 XLM, but DEX only filled 600 XLM; remainder is 400 XLM
            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 'leg-1-partial',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 1000,
                    executedAmount: 600,
                    remainingAmount: 400,
                    status: 'partial',
                    sideEffectApplied: true
                },
                {
                    tradeId: 'leg-2-unreached',
                    fromAsset: 'USDC',
                    toAsset: 'BTC',
                    requestedAmount: 50,
                    executedAmount: 0,
                    remainingAmount: 50,
                    status: 'failed',
                    sideEffectApplied: false
                }
            ]

            const decision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades,
                attempt: 1,
                maxAttempts: 3,
                isRetryable: true
            })

            const retryPlan = buildSafeRetryPlan(decision)

            expect(retryPlan).toHaveLength(2)
            // Retry for leg 1 must ONLY trade the remaining 400 XLM, NOT the full 1000 XLM
            const leg1Retry = retryPlan.find(r => r.tradeId.includes('leg-1-partial'))
            expect(leg1Retry?.amount).toBe(400)

            // Retry for leg 2 trades the full 50 USDC
            const leg2Retry = retryPlan.find(r => r.tradeId.includes('leg-2-unreached'))
            expect(leg2Retry?.amount).toBe(50)
        })

        it('explicitly stops when stopOnFailure is true or retry budget is exhausted', () => {
            const initialBalances = { XLM: 1000, USDC: 50 }
            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 'leg-1',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 500,
                    executedAmount: 500,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true
                },
                {
                    tradeId: 'leg-2',
                    fromAsset: 'USDC',
                    toAsset: 'BTC',
                    requestedAmount: 25,
                    executedAmount: 0,
                    remainingAmount: 25,
                    status: 'failed',
                    sideEffectApplied: false,
                    failureReason: 'Permanent insufficient liquidity'
                }
            ]

            // Test 1: stopOnFailure = true
            const stoppedDecision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades,
                stopOnFailure: true
            })

            expect(stoppedDecision.actionTaken).toBe('stop')
            expect(stoppedDecision.retryOutcome?.retryScheduled).toBe(false)
            expect(stoppedDecision.retryOutcome?.action).toBe('stop')
            expect(stoppedDecision.observability.outcome).toBe('blocked')
            expect(stoppedDecision.observability.reasonCode).toBe('partial_trade_explicit_stop')

            // Test 2: retry budget exhausted (attempt 3 of 3)
            const exhaustedDecision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades,
                attempt: 3,
                maxAttempts: 3,
                isRetryable: true
            })

            expect(exhaustedDecision.actionTaken).toBe('stop')
            expect(exhaustedDecision.retryOutcome?.retryScheduled).toBe(false)
            expect(exhaustedDecision.retryOutcome?.retriesRemaining).toBe(0)
            expect(exhaustedDecision.observability.outcome).toBe('blocked')
            expect(exhaustedDecision.observability.reasonCode).toBe('partial_trade_retry_exhausted')
        })
    })

    // ──────────────────────────────────────────────────────────────────────────
    // 3. SPR-2026-128 [DATA] Preserve state consistency in Partial trade handling
    // ──────────────────────────────────────────────────────────────────────────
    describe('SPR-2026-128 [DATA] Preserve state consistency during concurrent & interrupted work', () => {
        it('blocks concurrent rebalances with conflict result and execution isolation', async () => {
            vi.spyOn(workerRuntime, 'acquireWorkerLock').mockResolvedValue(false)

            const decision = await executeWithPartialTradeBoundary(portfolioId, async () => {
                throw new Error('Should not execute when lock is held')
            })

            expect(decision.result).toBe('conflict')
            expect(decision.status).toBe('failed')
            expect(decision.observability.reasonCode).toBe('conflict_rebalancing')
            expect(decision.failureReason).toContain('already in progress')
        })

        it('releases lock and persists failure record when work is interrupted by unexpected error', async () => {
            vi.spyOn(workerRuntime, 'acquireWorkerLock').mockResolvedValue(true)
            const releaseSpy = vi.spyOn(workerRuntime, 'releaseWorkerLock').mockResolvedValue(undefined)
            const recordSpy = vi.spyOn(rebalanceHistoryService, 'recordRebalanceEvent').mockResolvedValue({
                id: 'evt-interrupted',
                portfolioId,
                timestamp: new Date().toISOString(),
                trigger: 'Rebalance Execution',
                trades: 0,
                gasUsed: '0 XLM',
                status: 'failed'
            })

            const decision = await executeWithPartialTradeBoundary(portfolioId, async () => {
                throw new Error('Process SIGTERM or sudden database disconnection')
            })

            expect(decision.result).toBe('failed')
            expect(decision.status).toBe('failed')
            expect(decision.observability.outcome).toBe('blocked')
            expect(decision.observability.reasonCode).toBe('interrupted_work')

            // Lock must always be safely released in finally
            expect(releaseSpy).toHaveBeenCalledWith(portfolioId)

            // State consistency: failure record persisted so externally visible state agrees
            expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
                portfolioId,
                status: 'failed',
                error: expect.stringContaining('Process SIGTERM')
            }))
        })

        it('guarantees persisted record and externally visible result strictly agree after partial trade execution', async () => {
            const recordSpy = vi.spyOn(rebalanceHistoryService, 'recordRebalanceEvent').mockResolvedValue({
                id: 'evt-partial-agree',
                portfolioId,
                timestamp: new Date().toISOString(),
                trigger: 'Manual Rebalance',
                trades: 1,
                gasUsed: '0.001 XLM',
                status: 'pending' // maps to partial
            })

            const initialBalances = { XLM: 1000, USDC: 50 }
            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 't-1',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 400,
                    executedAmount: 400,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true,
                    estimatedReceivedAmount: 40
                },
                {
                    tradeId: 't-2',
                    fromAsset: 'USDC',
                    toAsset: 'BTC',
                    requestedAmount: 20,
                    executedAmount: 0,
                    remainingAmount: 20,
                    status: 'failed',
                    sideEffectApplied: false,
                    failureReason: 'Price limit exceeded'
                }
            ]

            const decision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades,
                failureReason: 'Price limit exceeded'
            })

            await persistPartialTradeRecord(decision, {
                trigger: 'Manual Rebalance',
                gasUsed: '0.001 XLM',
                feePaid: 0.001
            })

            expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
                portfolioId,
                status: 'pending', // DB schema status for partial
                trades: 1,
                gasUsed: '0.001 XLM',
                feePaid: 0.001,
                details: expect.objectContaining({
                    executionStatus: 'partial',
                    result: 'partial',
                    postTradeWeights: decision.postTradeWeights,
                    residualWork: decision.residualWork
                })
            }))
        })
    })

    // ──────────────────────────────────────────────────────────────────────────
    // 4. SPR-2026-129 [OBS] Surface actionable Partial trade handling outcomes
    // ──────────────────────────────────────────────────────────────────────────
    describe('SPR-2026-129 [OBS] Surface actionable outcomes and redact secrets', () => {
        it('allows operators to distinguish success, delay, and blocked outcomes', () => {
            const initialBalances = { XLM: 1000, USDC: 50 }

            // 1. Success outcome
            const successDecision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances: { XLM: 1000, USDC: 0 },
                targetAllocations: { XLM: 60, USDC: 40 },
                prices,
                trades: [{
                    tradeId: 't1',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 400,
                    executedAmount: 400,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true,
                    estimatedReceivedAmount: 40
                }]
            })
            expect(successDecision.observability.outcome).toBe('success')

            // 2. Delayed outcome (retryable with budget)
            const delayDecision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades: [
                    {
                        tradeId: 't1',
                        fromAsset: 'XLM',
                        toAsset: 'USDC',
                        requestedAmount: 400,
                        executedAmount: 400,
                        remainingAmount: 0,
                        status: 'executed',
                        sideEffectApplied: true
                    },
                    {
                        tradeId: 't2',
                        fromAsset: 'USDC',
                        toAsset: 'BTC',
                        requestedAmount: 20,
                        executedAmount: 0,
                        remainingAmount: 20,
                        status: 'failed',
                        sideEffectApplied: false
                    }
                ],
                attempt: 1,
                maxAttempts: 3,
                isRetryable: true
            })
            expect(delayDecision.observability.outcome).toBe('delay')

            // 3. Blocked outcome (stopped or retries exhausted)
            const blockedDecision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations,
                prices,
                trades: [
                    {
                        tradeId: 't1',
                        fromAsset: 'XLM',
                        toAsset: 'USDC',
                        requestedAmount: 400,
                        executedAmount: 400,
                        remainingAmount: 0,
                        status: 'executed',
                        sideEffectApplied: true
                    },
                    {
                        tradeId: 't2',
                        fromAsset: 'USDC',
                        toAsset: 'BTC',
                        requestedAmount: 20,
                        executedAmount: 0,
                        remainingAmount: 20,
                        status: 'failed',
                        sideEffectApplied: false
                    }
                ],
                attempt: 3,
                maxAttempts: 3,
                isRetryable: true
            })
            expect(blockedDecision.observability.outcome).toBe('blocked')
        })

        it('redacts Stellar secret keys, passwords, and API tokens from diagnostic messages', () => {
            const rawError = 'Failed to execute trade with secret key SBVO3MNV7V2M23N5B7YTXQ4NZJ32PQ45P3WJ45Q7Y8N9B1C2D3E4F5G6 and password "topsecret123" and api_key cg-1234567890abcdef'
            const sanitized = sanitizeDiagnostics(rawError)

            expect(sanitized).not.toContain('SBVO3MNV7V2M23N5B7YTXQ4NZJ32PQ45P3WJ45Q7Y8N9B1C2D3E4F5G6')
            expect(sanitized).not.toContain('topsecret123')
            expect(sanitized).not.toContain('cg-1234567890abcdef')
            expect(sanitized).toContain('[REDACTED]')
        })
    })

    // ──────────────────────────────────────────────────────────────────────────
    // 5. SPR-2026-130 [TEST] Deterministic edge cases with isolated doubles
    // ──────────────────────────────────────────────────────────────────────────
    describe('SPR-2026-130 [TEST] Deterministic multi-asset edge cases', () => {
        it('handles 4-asset portfolio where first two legs fill and third fails', () => {
            const initialBalances = {
                XLM: 2000,
                USDC: 100,
                BTC: 0,
                ETH: 0
            }
            const fourAssetPrices = {
                XLM: 0.1,
                USDC: 1.0,
                BTC: 20000,
                ETH: 2000
            }
            const fourAssetTargets = {
                XLM: 25,
                USDC: 25,
                BTC: 25,
                ETH: 25
            }

            const trades: PartialTradeLeg[] = [
                {
                    tradeId: 'leg-1',
                    fromAsset: 'XLM',
                    toAsset: 'USDC',
                    requestedAmount: 500,
                    executedAmount: 500,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true,
                    estimatedReceivedAmount: 50
                },
                {
                    tradeId: 'leg-2',
                    fromAsset: 'USDC',
                    toAsset: 'BTC',
                    requestedAmount: 50,
                    executedAmount: 50,
                    remainingAmount: 0,
                    status: 'executed',
                    sideEffectApplied: true,
                    estimatedReceivedAmount: 0.0025
                },
                {
                    tradeId: 'leg-3',
                    fromAsset: 'XLM',
                    toAsset: 'ETH',
                    requestedAmount: 500,
                    executedAmount: 0,
                    remainingAmount: 500,
                    status: 'failed',
                    sideEffectApplied: false,
                    failureReason: 'Horizon DEX path error'
                }
            ]

            const decision = evaluatePartialTradeDecision({
                portfolioId,
                initialBalances,
                targetAllocations: fourAssetTargets,
                prices: fourAssetPrices,
                trades,
                isRetryable: true,
                attempt: 1,
                maxAttempts: 3
            })

            expect(decision.result).toBe('partial')
            expect(decision.executedTradesCount).toBe(2)
            expect(decision.failedTradesCount).toBe(1)
            expect(decision.residualWork.hasResidualWork).toBe(true)
            expect(decision.postTradeBalances).toEqual({ XLM: 1500, USDC: 100, BTC: 0.0025, ETH: 0 })
            expect(decision.postTradeWeights).toEqual({ XLM: 50, USDC: 33.33, BTC: 16.67, ETH: 0 })
            expect(decision.residualWork.remainingTrades).toEqual([
                expect.objectContaining({ tradeId: 'leg-3', remainingAmount: 500 })
            ])

            // Safe retry plan must ONLY contain leg-3, strictly excluding leg-1 and leg-2
            const retryPlan = buildSafeRetryPlan(decision)
            expect(retryPlan).toHaveLength(1)
            expect(retryPlan[0].tradeId).toContain('leg-3')
            expect(retryPlan[0].amount).toBe(500)
            expect(retryPlan[0].fromAsset).toBe('XLM')
            expect(retryPlan[0].toAsset).toBe('ETH')
        })
    })
})
