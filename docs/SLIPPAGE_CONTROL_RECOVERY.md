# Slippage Control Recovery

**Issue**: #1956 (SPR-2026-032) · **Area**: `frontend` · **Component**: `RebalanceConfirm`

This document describes how the rebalance confirmation flow detects and recovers from a stale quote after the portfolio slippage tolerance changes, and from execution rejected because of slippage.

## 1. Stale tolerance (detected before submission)

The plan snapshot records the slippage tolerance (`maxSlippagePercent`) that was in effect when the trades were quoted. The review modal also reads the portfolio's current `slippageTolerancePercent` (falling back to `slippageTolerance`).

If both values are available and differ:

- An alert banner explains that the plan was quoted with the old tolerance and shows both values.
- **Confirm rebalance** stays disabled, even after the review acknowledgement is checked. Stale prices must not be executed under a changed tolerance.
- A **Refresh plan** button re-fetches the rebalance plan. A refreshed plan carries the new tolerance, clears the banner, and requires the user to acknowledge the new trades before confirming.

Refreshing only clears state inside the review modal. Unrelated edits elsewhere (for example the portfolio setup form) are untouched.

## 2. Slippage rejection during execution

If the execution request fails with a slippage-, tolerance-, price-move-, or stale-quote-related error:

- The error alert explains that nothing was executed because prices moved beyond the configured slippage limit.
- A **Refresh quote and retry** button clears the error and re-fetches the plan for fresh prices.
- The acknowledgement is reset, so the user must review and confirm the new trades.

Other execution failures keep the existing path: the alert reports the error, the acknowledgement is reset, and the user can re-acknowledge and retry or cancel.

## 3. Duplicate-action guards

- A submission ref plus the mutation's pending state prevent double submissions and duplicate refresh requests.
- All recovery actions are disabled while a plan fetch or submission is in flight.
- The acknowledgement is always cleared when the plan object changes, so a refreshed quote can never be confirmed with a stale review.

## 4. Accessibility

- Both the stale-tolerance banner and the execution failure use `role="alert"`; the failure alert receives focus when it appears.
- In-flight and refresh transitions are announced through a polite `role="status"` region.
- The recovery buttons are standard focusable controls with accessible names.

## 5. Test coverage

`frontend/src/components/RebalanceConfirm.test.tsx` covers:

- Trade rendering and confirmation gated on acknowledgement.
- Read-only preview when there are no trades.
- Stale tolerance detection, blocked confirmation, and refresh recovery.
- Slippage execution failure with quote refresh and successful retry.
- Non-slippage execution failure with acknowledgement reset and retry.
- Rapid double-click producing a single submission.

Run:

```bash
cd frontend
npx vitest run src/components/RebalanceConfirm.test.tsx
```
