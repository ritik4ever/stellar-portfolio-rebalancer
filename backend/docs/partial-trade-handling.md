# Partial Trade Handling Service Boundary

Partial trade handling is part of the portfolio rebalancing workflow. This document specifies the service boundary handling, recovery invariants, state consistency guarantees, and observability signals for partial fills and multi-asset trade failures (SPR-2026-126, SPR-2026-127, SPR-2026-128, SPR-2026-129).

## Overview

In a multi-asset portfolio rebalancing operation, reaching target allocations requires executing multiple trade legs (e.g., selling overweighted assets to buy underweighted assets). When one fill completes but a subsequent trade fails or only a partial fill is achieved on the DEX, the system must handle the boundary deterministically rather than treating the operation as a monolithic success or opaque failure.

## 1. Boundary Handling: One Fill in Multi-Asset Rebalance (SPR-2026-126)

At the service boundary, the rebalancing decision documents the actual post-trade weights and residual work with a stable result:

- **Actual Post-Trade Weights**: When a trade leg executes (e.g. Asset A sold for Asset B), post-trade balances update immediately to reflect the executed quantities. Post-trade weights are computed from updated balances and current asset prices:
  $$\text{Weight}_i = \frac{\text{Balance}_i \times \text{Price}_i}{\sum_j (\text{Balance}_j \times \text{Price}_j)} \times 100$$
  Weights strictly reflect the executed leg rather than theoretical targets or stale pre-trade balances.

- **Residual Work**: The decision explicitly calculates remaining work required to reach target weights:
  - `remainingTrades`: List of unexecuted legs or unfilled quantities of partially filled legs with estimated USD notional.
  - `assetDrift`: Difference between actual post-trade weight and target allocation for each asset.
  - `totalResidualValueUsd`: Aggregate USD value of pending trades.
  - `pendingTradesCount`: Count of trades remaining to be executed.

- **Stable Result**:
  - `success`: All planned legs executed completely; post-trade weights match target weights; residual work is empty.
  - `partial`: At least one trade leg executed or partially filled, and residual work remains or a subsequent leg failed/stopped.
  - `failed`: No trade leg executed any filled volume.
  - `conflict`: Concurrency guard prevented execution due to an active rebalance.

## 2. Safe Recovery and Bounded Retries (SPR-2026-127)

When a subsequent trade leg fails after an earlier fill has already completed on-chain or on the DEX:

- **Absence of Duplicate Side Effects**:
  Retries can **never** re-execute legs that have already completed.
  - A leg that already filled 100% (`sideEffectApplied: true && remainingAmount <= 0`) is strictly excluded from retry plans.
  - A leg that partially filled (`sideEffectApplied: true && remainingAmount > 0`) is retried ONLY for the remaining unexecuted portion (`remainingAmount`), never the original requested amount.
  - Only unexecuted legs (`executedAmount === 0`) are retried in full.

- **Bounded Retry vs. Explicit Stop**:
  - **Bounded Retry**: If the failure is classified as retryable (e.g. temporary Horizon RPC timeout, 429 rate limit, network blip) and `attempt < maxAttempts`, a retry is scheduled for the residual work.
  - **Explicit Stop**: If the failure is non-retryable (e.g. asset liquidity exhausted, market spread exceeded, invalid account authorization, slippage limit breached, or explicit stop configured via `stopOnFailure: true`), or if the retry budget is exhausted (`attempt >= maxAttempts`), the system explicitly stops further execution.
  - The portfolio remains in its valid post-trade state, documenting actual post-trade weights and residual work, and the failure remains fully diagnosable without leaving unrecorded state.

## 3. Preserving State Consistency (SPR-2026-128)

The system ensures state consistency during concurrent and interrupted work:

- **Concurrency Isolation**:
  - Every rebalance execution acquires an exclusive per-portfolio worker lock (`acquireWorkerLock`) and registers in the active rebalance tracker (`markRebalanceActive`).
  - Concurrent rebalance requests or conflicting allocation edits are rejected at the boundary with HTTP 409 CONFLICT (`conflict_rebalancing`), preventing race conditions and interleaving trade side effects.

- **Interrupted Work Recovery**:
  - All rebalance executions wrap trade execution in structured `try ... finally` blocks guaranteeing locks are released even on process exceptions or uncaught errors.
  - If a worker or API handler is interrupted after an earlier leg has filled, the partial progress is persisted to the database before the error propagates.

- **Agreement Between Persisted Record and Visible Result**:
  - The HTTP response payload returned to the caller (`result.status`, `result.postTradeWeights`, `result.residualWork`) and the database record stored in `rebalance_events` and `rebalance_history` agree in lockstep.
  - Querying `GET /api/rebalance/history` or `GET /api/portfolio/:id/rebalance-history` returns matching status (`partial`, `success`, or `failed`), executed trade count, and diagnostic context.

## 4. Actionable Observability Signals (SPR-2026-129)

Operators can distinguish execution outcomes directly from metrics and structured logs without guessing:

- **Outcome States**:
  - `success`: The rebalance completed in full with all planned legs executed.
  - `delay`: A trade leg failed with a retryable condition; a bounded retry is scheduled for residual work.
  - `blocked`: Execution cannot make progress on its own (permanent error, retry budget exhausted, or explicit stop triggered); manual operator intervention or investigation is required.

- **Secret Redaction**:
  - Stellar private keys (`S[A-Z2-7]{55}`), API keys (`c?g-[a-zA-Z0-9_-]{10,}`), Bearer tokens, database credentials, and passwords are automatically redacted to `[REDACTED]` in error strings, logs, and database records.

- **Prometheus Metric**:
  - `rebalance_partial_trade_outcomes_total` with labels `source` (e.g. `api`, `worker`), `outcome` (`success`, `delay`, `blocked`), and `reason_code`.
