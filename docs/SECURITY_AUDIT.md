# Security audit log — portfolio rebalancer contract

This document records focused security findings for the Soroban portfolio
rebalancer. Entries are append-only review notes; they do not replace a full
third-party audit.

| Date       | Reviewer / issue | Area |
| ---------- | ---------------- | ---- |
| 2026-07-27 | #1523            | Re-entrancy via Reflector `lastprice` during rebalance |

## Finding REENT-001 — External Reflector call ordering vs. portfolio state during `execute_rebalance`

### Summary

During `execute_rebalance`, the contract performs multiple cross-contract calls
to the configured Reflector oracle (`ReflectorClient::lastprice`) **before** the
updated `Portfolio` struct is persisted. Fee collection also performs SAC
`token::transfer` interactions **before** that final persistence. This ordering
does not match strict **checks → effects → interactions (CEI)** hardening for
the rebalance path. Re-entrancy from a **malicious contract installed at
`ReflectorAddress`** is theoretically possible at the Soroban VM level; practical
fund-loss scenarios are largely mitigated by Soroban authorization rules and the
expected deployment trust model, but CEI gaps remain relevant for defense in depth
and non-standard tokens.

**Severity:** **Medium** (configuration / trust-boundary and CEI ordering; not
exploitable against the canonical Reflector deployment under normal admin
practice)

**Remediation status:** **Open** — documented only in this review (#1523).
Implementation hardening (CEI reorder, optional reentrancy guard, oracle address
allowlist) is tracked as separate engineering work on the same code path.

### Scope and code references

Primary logic:

- `contracts/src/portfolio.rs` — `calculate_portfolio_value`,
  `build_rebalance_preview` (oracle reads in loops).
- `contracts/src/lib.rs` — `execute_rebalance_internal` (orchestration, trade
  application, persistence).

Reflector interface: `contracts/src/reflector.rs` (`lastprice` → external call).

### External call inventory (rebalance execution path)

For one successful `execute_rebalance` / `admin_force_rebalance` invocation,
oracle interactions occur in this order:

1. **`build_rebalance_preview`** (called from `execute_rebalance_internal`):
   - `calculate_portfolio_value`: one `lastprice` per entry in
     `current_balances`.
   - Per target allocation asset: another `lastprice` (staleness check + price
     map).
2. **Optional slippage validation** (when `actual_balances` is non-empty):
   - `calculate_portfolio_value` again (another `lastprice` loop over balances).
   - Per allocation asset: `lastprice` again for slippage math.

Read-only preview helpers (`preview_rebalance`, `check_rebalance_needed`,
`get_drift_preview`, `get_portfolio_value_usd`) use the same
`build_rebalance_preview` / `calculate_portfolio_value` patterns but do not
mutate portfolio balances.

### State writes vs. interactions (ordering)

In `execute_rebalance_internal` (`lib.rs`), approximate ordering is:

| Step | Action | Persistent portfolio state |
| ---- | ------ | -------------------------- |
| 1 | Load portfolio | Unchanged (read) |
| 2 | Auth, cooldown, invariants | Unchanged |
| 3 | `guard_ledger_timestamp` | **Instance** `LastTimestamp` updated |
| 4 | Reflector calls (preview + optional slippage) | Portfolio **unchanged** |
| 5 | Apply trades in memory; SAC fee `transfer` | Portfolio **not yet** written |
| 6 | `set(Portfolio)` | **Committed** |
| 7 | Events, NAV snapshot | Post-commit |

Portfolio balance **effects** are held in a local `mut portfolio` until step 6,
while **interactions** (Reflector, then fee transfers) already ran in steps 4–5.
That is a classic CEI deviation: interactions precede the durable effects that
should define re-entrancy-safe state.

Cross-reference: **CEI hardening** for this path (persist planned state before
external calls, or snapshot prices then execute without further oracle calls;
move fee transfers after portfolio persistence; optional contract-local
reentrancy mutex) is intentionally **out of scope for #1523** and should land
via dedicated implementation issues on `execute_rebalance_internal` and
`portfolio.rs` helpers.

### Re-entrancy assessment

**Mechanism.** Soroban allows nested contract calls. If `ReflectorAddress`
points to attacker-controlled WASM, `lastprice` can invoke back into
`PortfolioRebalancer` while the outer rebalance is mid-flight and before step 6
commits portfolio balances.

**Trust boundary.** At initialization, admin sets `ReflectorAddress`
(`initialize` in `lib.rs`). Production intent (see ADR 0002) is the official
Reflector oracle contract, which does not re-enter callers. Risk materializes
mainly when admin misconfigures the address, deploys to a compromised instance
storage, or an upgrade swaps the oracle to malicious code.

**Authorization on nested calls.** State-changing entrypoints require
`require_auth` on steward, user, or admin (e.g. `execute_rebalance` → steward,
`withdraw` → user). Soroban does not automatically propagate authorization from
the outer user invocation through an untrusted callee; a nested
`execute_rebalance` from a malicious oracle therefore **should revert** at
`steward.require_auth()` unless the steward signed that nested invocation
separately. That sharply limits classic “double rebalance” theft without
 additional auth bugs.

**What re-entry can still do.** During oracle callbacks, persistent portfolio
balances remain at pre-rebalance values, while the outer frame may already have
passed cooldown (via `last_rebalance` on stored state) and updated
`LastTimestamp`. A nested call that only uses **read** APIs (`get_portfolio`,
`preview_rebalance`, valuation views) observes stale on-chain balances relative
to the outer frame’s in-memory trade plan—useful for monitoring, not direct
theft. Nested **authorized** calls (if an attacker could trick the steward into
signing multiple invocations in one transaction) could interleave deposits,
withdrawals, or a second rebalance; that is a broader transaction-composition
concern, not unique to Reflector, but the oracle hook expands the window before
portfolio persistence.

**Token re-entrancy.** Fee `token::transfer` runs before portfolio `set`. Standard
Stellar Asset Contract (SAC) tokens do not execute user hooks on transfer, so
SAC fee collection is not a practical re-entrancy vector. Custom token contracts
with callbacks would reintroduce CEI risk on the fee path; the portfolio assumes
standard SAC assets for fee-bearing tokens.

### Worst-case impact scenario (concrete)

Assume:

1. `ReflectorAddress` is malicious (admin mistake or compromised admin key).
2. Steward executes one honest `execute_rebalance` transaction (single auth).
3. On the first `lastprice` during `build_rebalance_preview`, the malicious
   oracle re-enters the portfolio contract.

**Scenario A — nested `execute_rebalance` without new steward signatures**

- Inner call fails at `steward.require_auth()`.
- Outer call continues with prices chosen by the malicious oracle (oracle
  manipulation / stale quote abuse), not classic re-entrancy double-spend.
- Impact: **incorrect trade sizing**, slippage check bypass if prices are
  inconsistent across sequential `lastprice` calls in the same tx, potential
  value drift vs. economic intent. Severity driven by oracle integrity, not
  re-entrancy alone.

**Scenario B — steward signed a bundled transaction with multiple portfolio
invocations** (e.g. social-engineered batch, compromised client)

- Malicious oracle re-enters during outer preview; inner authorized
  `withdraw` / `execute_rebalance` runs while outer frame has not persisted
  new balances.
- Outer frame then applies trades from preview computed on **pre-nested** storage
  state, while inner call may have changed balances or `last_rebalance`.
- Impact: **accounting desync** between recorded `current_balances` and actual
  SAC holdings, double application of logical trade deltas, or cooldown /
  threshold bypass relative to user expectations. Worst case: **loss of user
  funds** proportional to portfolio size if withdrawals and rebalance trades
  compose maliciously in one ledger transaction.

**Scenario C — canonical Reflector, CEI ordering only**

- No hostile re-entry from oracle; remaining issue is ordering (fee transfer
  before persist). With SAC, **no observed exploit**; residual **Medium** as
  defense-in-depth and future token compatibility.

### Recommendations (remediation backlog)

| Priority | Action | Status |
| -------- | ------ | ------ |
| P1 | CEI hardening in `execute_rebalance_internal`: commit balance updates before external fee transfers; avoid further oracle calls after local state is finalized | Open |
| P1 | Single price snapshot per asset per rebalance (no redundant `lastprice` in preview + slippage loops) | Open |
| P2 | Document / enforce allowed Reflector contract IDs at `initialize` + upgrade checklist | Open |
| P2 | Optional reentrancy guard (storage flag) around rebalance execution | Open |
| P3 | Integration test with malicious mock oracle attempting nested portfolio calls | Open |

### Accepted mitigations (no code change required for #1523)

- Operational use of official Reflector contract address on each network.
- Admin key hygiene and `ReflectorAddress` verification in
  [`CONTRACT_DEPLOYMENT_CHECKLIST.md`](CONTRACT_DEPLOYMENT_CHECKLIST.md).
- Staleness checks in `build_rebalance_preview` (`REFLECTOR_PRICE_MAX_AGE_SECONDS`
  / 3600s window in preview path).

### Tests reviewed

Existing coverage exercises rebalance with benign mock Reflector (`contracts/src/test.rs`,
`contracts/tests/integration_tests.rs`) but does **not** simulate malicious
re-entering oracle behavior; adding such a test is listed in the remediation
backlog above.
