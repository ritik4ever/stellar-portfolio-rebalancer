# Rebalance Submission Failure Recovery

**Issue**: SPR-2026-047 · **Area**: `frontend` · **Component**: `RebalanceConfirm`

This document describes how the rebalance confirmation modal recovers from wallet signature rejection and lost network acknowledgements without duplicating actions or discarding unrelated edits.

## 1. Wallet signature rejection

When a submission fails because the user declined, cancelled, or rejected signing in their wallet:

- The error alert displays **Wallet signature rejected** and clarifies that no transaction was submitted to the network.
- An actionable **Retry signing** button lets the user retry directly after unlocking or switching their wallet, guarded by the same in-flight submission lock so rapid clicks cannot trigger duplicate submissions.
- Dismissing or retrying only affects state inside the review modal; unrelated edits elsewhere in the app remain intact.

## 2. Lost network acknowledgement

When a submission fails due to a dropped connection, timeout, or lost network acknowledgement:

- The error alert displays **Network acknowledgement lost** and warns that the rebalance may have already been submitted.
- **Confirm rebalance** stays disabled even if the review checkbox is re-checked, preventing blind duplicate submissions.
- An actionable **Check status & refresh plan** button refetches the rebalance plan and clears the alert.
  - If the original rebalance succeeded, the refreshed plan reflects the updated state (e.g. 0 planned trades).
  - If the rebalance did not execute, the user can review the fresh plan, re-acknowledge, and safely retry.

## 3. Other execution failures

- Slippage/stale-quote rejections continue to offer **Refresh quote and retry** (see `docs/SLIPPAGE_CONTROL_RECOVERY.md`).
- Generic failures continue to reset acknowledgement and let the user review and retry or cancel.

## 4. Test coverage

`frontend/src/components/RebalanceConfirm.test.tsx` covers:

- Wallet signature rejection explanation, actionable retry, and duplicate-click guard.
- Lost network acknowledgement warning, blocked blind resubmission, and status-check refresh recovery.
- Generic non-slippage failure recovery, slippage recovery, and duplicate submission guards.

Run:

```bash
cd frontend
npx vitest run src/components/RebalanceConfirm.test.tsx
```
