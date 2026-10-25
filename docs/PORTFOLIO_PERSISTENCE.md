# Portfolio Persistence Boundary & Concurrency Control

> **Scope**: Backend portfolio persistence service boundary and execution coordination  
> **Related Issue**: SPR-2026-156 (#2080)  
> **Batch Context**: SPR-2026-156 to SPR-2026-160

---

## Overview

The portfolio persistence lifecycle coordinates concurrent state changes across two primary actors:
1. **The Rebalancing Workflow**: Asynchronous or manual trade execution engine that reads allocations, calculates target balance rebalancing, places DEX/contract trades, and records outcome version bumps.
2. **User Allocation Edits**: Synchronous API requests (`PUT /api/portfolio/:id`, `PUT /api/portfolio/:id/allocations`, `PATCH /api/portfolio/:id/allocations`) submitted to alter target asset percentages.

To guarantee that concurrent allocation edits do not corrupt in-flight rebalancing calculations or cause silent overwrites, the persistence service boundary implements explicit boundary coordination, compare-and-set (CAS) versioning, and deterministic result documentation.

---

## Service Boundary Contract

### `applyAllocationEdit(params)`

Located in [`backend/src/services/portfolioPersistenceBoundary.ts`](../backend/src/services/portfolioPersistenceBoundary.ts), this function provides the single source of truth for committing target allocation modifications.

```typescript
export interface ApplyAllocationEditParams {
    portfolioId: string
    allocations: Record<string, number>
    expectedVersion?: number
    storage?: {
        getPortfolio(id: string): Promise<Portfolio | undefined>
        updatePortfolio(id: string, updates: Partial<Portfolio>, expectedVersion?: number): Promise<boolean>
    }
}
```

### Result Codes (`AllocationEditResultCode`)

Every evaluation returns a structured `AllocationEditDecision` object documenting:
- `applied`: boolean indicating whether the edit was committed to storage.
- `committedVersion`: integer representing the latest committed portfolio version.
- `executionState`: current rebalancing state (`idle` | `rebalancing` | `completed` | `failed`).
- `result`: stable machine-readable decision code.
- `reason`: explanatory message for diagnostics and clients.

| Result Code | HTTP Status | Description | Execution State | State Mutated? |
|-------------|-------------|-------------|-----------------|----------------|
| `committed` | 200 | Edit passed all validations and was atomically committed. | `idle` | Yes (`version + 1`) |
| `conflict_rebalancing` | 409 | Rejected because rebalance execution is actively in flight. | `rebalancing` | No |
| `conflict_version` | 409 | Rejected because caller supplied a stale `expectedVersion` (e.g. rebalance advanced version). | `completed` or `idle` | No |
| `validation_error` | 400 / 422 | Target allocations do not sum to 100% or exceed 10 assets. | `idle` | No |
| `not_found` | 404 | Target portfolio ID does not exist. | `idle` | No |

---

## State Transition Rules

### 1. Active Rebalance In Flight
When a portfolio rebalance starts (either manual via `POST /api/portfolio/:id/rebalance` or worker job via `rebalanceWorker`):
- `markRebalanceActive(portfolioId, metadata)` registers active execution.
- Any allocation edit submitted during this window is rejected with `result: 'conflict_rebalancing'`, `executionState: 'rebalancing'`, and documents current `committedVersion`.
- Stored allocations remain unchanged, ensuring the active rebalancing loop executes against immutable target weights.

### 2. Version Advance (CAS Guard)
- When a rebalance successfully commits or updates state, the portfolio version advances (e.g. from version `N` to `N + 1`).
- An allocation edit carrying stale `expectedVersion: N` is rejected with `result: 'conflict_version'`.
- The error response includes the current `committedVersion: N + 1`, enabling the client to refresh state and prompt the user to re-apply changes.

### 3. Sequential Edits
- When the rebalance completes, `markRebalanceInactive(portfolioId, { status: 'completed' })` clears the active lock.
- Subsequent allocation edits providing matching `expectedVersion: N + 1` succeed immediately, committing version `N + 2` with `executionState: 'idle'` and `result: 'committed'`.

## Persistence Outcome Signals

Rebalance-history writes emit the Prometheus counter
`stellar_portfolio_portfolio_persistence_outcomes_total` (the configured metrics
prefix may change the name). Its bounded labels are:

| Label | Values | Meaning |
|-------|--------|---------|
| `source` | `api`, `worker`, `other` | Persistence caller |
| `outcome` | `success`, `delayed`, `blocked` | Write succeeded, can be safely retried, or must stop |
| `event_status` | `completed`, `failed`, `pending` | Rebalance event status being persisted |
| `state_transition` | `committed`, `not_committed`, `unknown` | Whether the portfolio transition is known to have committed |

Structured logs use the same dimensions and include the write operation,
duration, a bounded portfolio bucket, and a safe database error code when
available. They do not include the raw portfolio ID or database error message.
Writes attempted after `executeRebalance` returns are never retried by
re-running the rebalance. If history persistence fails, the worker completes
the job and reports `historyPersisted: false` in its completion notification;
the manual API also returns the execution result with `historyPersisted: false`.
Both paths log a bounded diagnostic and record the committed (or unknown)
transition as `blocked`. This explicit stop avoids replaying trades that may
already have been submitted. Retryable failures before execution commits retain
the queue's bounded retry policy and are reported as `delayed` while attempts
remain.

---

## API Endpoints

### `PUT /api/portfolio/:id/allocations`
**Request Body**:
```json
{
  "allocations": {
    "XLM": 60,
    "USDC": 40
  },
  "version": 1
}
```

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "portfolio": {
      "id": "portfolio-123",
      "allocations": { "XLM": 60, "USDC": 40 },
      "version": 2
    },
    "committedVersion": 2,
    "executionState": "idle",
    "result": "committed",
    "decision": {
      "applied": true,
      "committedVersion": 2,
      "executionState": "idle",
      "result": "committed",
      "reason": "Allocation edit successfully committed"
    }
  }
}
```

**Conflict Response: Active Rebalance (HTTP 409)**:
```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Cannot edit allocations: portfolio portfolio-123 is actively rebalancing",
    "details": {
      "committedVersion": 1,
      "currentVersion": 1,
      "executionState": "rebalancing",
      "result": "conflict_rebalancing",
      "decision": {
        "applied": false,
        "committedVersion": 1,
        "executionState": "rebalancing",
        "result": "conflict_rebalancing",
        "reason": "Cannot edit allocations: portfolio portfolio-123 is actively rebalancing"
      }
    }
  }
}
```

**Conflict Response: Stale Version (HTTP 409)**:
```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Portfolio version conflict: expected version 1, but committed version is 2",
    "details": {
      "committedVersion": 2,
      "currentVersion": 2,
      "executionState": "completed",
      "result": "conflict_version",
      "decision": {
        "applied": false,
        "committedVersion": 2,
        "executionState": "completed",
        "result": "conflict_version"
      }
    }
  }
}
```

---

## Testing & Validation

The test suite in [`backend/src/test/portfolioPersistenceBoundary.test.ts`](../backend/src/test/portfolioPersistenceBoundary.test.ts) exercises:
1. Clean commit when idle documenting `committedVersion: 2`, `executionState: 'idle'`, and `result: 'committed'`.
2. Immediate rejection when rebalance is in-flight (`executionState: 'rebalancing'`, `result: 'conflict_rebalancing'`).
3. CAS stale version detection after rebalance completion (`result: 'conflict_version'`).
4. Sequential edit retry against updated version.
5. Allocation weight validation constraints (sum != 100%, empty, > 10 assets).
6. Non-existent portfolio ID handling (`result: 'not_found'`).
7. Storage guard parity across `portfolioStorage` and `databaseService`.
8. HTTP route integration for `PUT /api/portfolio/:id/allocations` and `PUT /api/portfolio/:id`.
