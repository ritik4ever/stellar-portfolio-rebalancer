# ADR 0004: Asset Custody / Token Transfer Model

## Status

Proposed

> Per [`docs/adr/README.md`](README.md) workflow, ADRs ship as **Proposed** at
> PR time and become **Accepted** once merged. This ADR is authored as
> **Proposed**; bump it to **Accepted** when the SAC-based custody contract
> is installed on the target network.

## Context

The Stellar Portfolio Rebalancer contract ([`PortfolioRebalancer`](../../contracts/src/lib.rs)) currently tracks portfolio holdings and rebalances using a mix of internal ledger mutation and a single off-chain reconciliation step. The contract exposes the familiar lifecycle entry points — `create_portfolio`, `deposit`, `withdraw`, `check_rebalance_needed`, `preview_rebalance`, `execute_rebalance`, plus related administrative surfaces — but its asset-transfer semantics are inconsistent and do not yet match the "real Stellar asset transfer" direction agreed for the project.

Concretely, the current on-chain behaviour is:

- `deposit` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)) increments `portfolio.current_balances` by `amount` but does **not** call `soroban_sdk::token::Client::transfer` to pull the asset into the contract. The same is true in the test suite: `client.deposit(&pid, &asset, &100, &String::from_str(&env, ""))` is purely an in-memory ledger update.
- `withdraw` decrements `portfolio.current_balances` but does **not** transfer the asset back to the user. The "withdraw" event is emitted after ledger mutation only.
- `execute_rebalance_internal` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)) iterates `preview.candidate_trades` and either adds or subtracts the trade amount from `portfolio.current_balances` *or* transfers the asset through `token::Client::transfer` for fee collection only. Slippage is checked against `actual_balances` supplied by the caller (the relayer/steward).
- The "actual" balances that drive the slippage envelope are read off-chain and passed in, but the contract never independently verifies that those balances reflect SAC state at the contract address.

The roles that exist today ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)) are `user` (owner), `steward` (delegated rebalancer, see `transfer_stewardship`), and `admin` (privileged operations, including `upgrade` and `set_emergency_stop`).

### Why a decision is needed now

1. The deposit / withdraw / fee-transfer triplet is internally inconsistent. Continuing to ship `deposit` as bookkeeping while `execute_rebalance_internal` performs a real `token::Client::transfer` for fees will revert with a SAC insufficient-balance error the moment fees are enabled on a portfolio whose balance was only ever recorded in the internal map ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)).
2. The "real Stellar asset transfer implementation" in flight needs a documented custody target. Without one, the new transfer paths cannot be authored against a stable contract.
3. The frontend/backend capability matrix ([`docs/CONTRACT_CAPABILITY_MATRIX.md`](../CONTRACT_CAPABILITY_MATRIX.md)) and event schema version ([`backend/src/config/contractEventSchema.ts`](../../backend/src/config/contractEventSchema.ts), [`frontend/src/lib/contractCapabilities.ts`](../../frontend/src/lib/contractCapabilities.ts)) need a known contract model to align against.
4. Existing portfolios (those created under the bookkeeping model) need a documented transition path. Without an ADR, migrated users risk balance desync or loss of fiduciary clarity.

### Decision criteria

We evaluate the three candidate custody models on:

- **Trust model & custody clarity.** Who legally holds the asset at each point in the lifecycle?
- **Slippage / MEV exposure.** Where is the trade decided, signed, and broadcast?
- **Slippage / oracle spoofing surface.** Can a malicious steward, oracle, or admin distort bookkeeping?
- **Operational complexity & gas profile.** Number of cross-contract invocations, CPU/memory pressure, DEX aggregator dependency.
- **Upgrade & emergency-stop semantics.** What happens if the contract is paused, upgrade-bugged, or its admin key is compromised?
- **Migration cost.** Field-level, storage footprint, event schema, backend, frontend, and existing-portfolio migration impact.

---

## Decision

We adopt **Contract-Held Custody via the Stellar Asset Contract (SAC)** as the unified asset-custody model. The Rebalancer contract becomes the custodian of user-supplied assets for the lifetime of a portfolio. All entry points that today mutate the internal `current_balances` map (`deposit`, `withdraw`, trade legs of `execute_rebalance`, and fee collection) will perform idempotent, auth-checked `soroban_sdk::token::Client::transfer` calls against the SAC of each managed asset.

The internal `current_balances` map is retained as an *indexed read-cache* and audit log keyed off SAC state, but it is no longer authoritative — the SAC contract balance held at the Rebalancer address is the source of truth. The contract will reconcile the index cache against the SAC at every entry point that mutates balances and will refuse to proceed if the cache drifts above a bounded tolerance (we call this the *reconciliation guarantee*).

### Comparison matrix

| Criterion | Option A — Contract-Held Custody (chosen) | Option B — Internal Bookkeeping (current) | Option C — User-Wallet Direct |
| :--- | :--- | :--- | :--- |
| **Custody clarity** | Rebalancer contract is unambiguous custodian. | Ambiguous — contract "tracks" balances the user holds elsewhere. | User retains self-custody; contract is a coordination layer only. |
| **Auth model** | One Soroban `require_auth()` per entry point; SAC `transfer` enforces payer authorization. | Steward can credit bookings without any on-chain proof of deposit. | User signs the exact Soroban auth payload for each trade. |
| **Slippage / MEV** | Sandbox path with min-out on DEX aggregator; rebalancer enforces slippage envelope. | Relayer-mediated; slippage check is post-hoc arithmetic only. | Strongest: each leg is co-signed with explicit price bounds. |
| **Bug blast radius** | Contract bug = drainable honeypot. Mitigated by emergency stop + upgrade + multisig admin. | Bug = balance desync between contract ledger and user's wallet. | Bug = users simply stop signing; capital never enters the contract. |
| **Gas profile (Soroban CPU)** | Highest — multiple SAC `transfer` and DEX invocations per rebalance. | Lowest — pure arithmetic + storage. | High — paid by user, per-leg auth verification. |
| **Operational complexity** | New ops burden (admin treasury, sweeping, SOC ops). | Lowest today, but fragile. | Requires Soroban `sponsor_*` auth patterns and fee-bump orchestration. |
| **Migration cost** | High one-time (sweep/V2 transition). | None today, but unsafe. | Highest (UX overhaul, signature flow rework). |

### Key rationale

- **Deterministic, on-chain provenance.** Every balance change is reconcilable against SAC state and the published event stream ([`contracts/CONTRACT_ABI.md`](../../contracts/CONTRACT_ABI.md), [`docs/CONTRACT_EVENTS.md`](../CONTRACT_EVENTS.md)).
- **Single point of audit.** Stewards, admins, and users all see the same source of truth — the SAC balance held at the Rebalancer address — so slippage disputes, fee accounting, and rebalance diffs become verifiable.
- **Aligns with Soroban primitives.** SAC is the canonical Stellar token interface; using `token::Client` is the only model the rest of the Soroban ecosystem composes against.
- **Already partially built.** `execute_rebalance_internal` already calls `token::Client::transfer` for fee collection ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)). Promoting the rest of the lifecycle to the same primitive eliminates the current state-machine inconsistency.
- **Compatible with staking, DCA, and fee strategies.** DCA ([`contracts/src/strategies/dca.rs`](../../contracts/src/strategies/dca.rs)) and the on-chain `FeeConfig` infrastructure ([`contracts/src/types.rs`](../../contracts/src/types.rs)) already assume a custodian-style contract; pairing them with real SAC transfers removes the current "ledger only" gap.

---

## Consequences

### Positive

- **Clear fiduciary model.** The contract is unambiguously the custodian during a portfolio's lifetime. Withdraw/sweep events match real on-chain value movements.
- **Deterministic slippage envelope.** `actual_balances` can be cross-checked against the SAC state at the contract address; off-chain relayers cannot falsify post-trade balances.
- **Composable with the rest of Soroban.** Other contracts (e.g. fee recipients, treasury, governance) can reason about Rebalancer-held assets without privileged off-chain data.
- **Eliminates the current inconsistency** between `deposit` (ledger only) and the fee `token::Client::transfer` call in `execute_rebalance_internal`.

### Negative

- **Honeypot risk.** A bug in the custodian contract could enable draining. Mitigations: multi-sig `admin` ([`contracts/src/types.rs`](../../contracts/src/types.rs)), `set_emergency_stop` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)), `pause_portfolio` (per-portfolio pause with `PauseReason`), and a hard time-locked upgrade path.
- **Reentrancy exposure.** `token::Client::transfer` is implemented in Soroban host space; cross-contract callbacks from malicious SAC implementations could attempt reentrancy. The contract already keys reentrancy-sensitive sections by `DataKey::EmergencyStop`. We will add a dedicated `DataKey::ReentrancyGuard` set across every SAC-touching path.
- **One-time migration complexity.** Existing portfolios created under the bookkeeping model must be swept to the new contract address.

### Neutral

- **Slightly higher gas.** Per `token::Client::transfer` call. We accept this as the cost of a clear custody model.
- **Storage footprint.** `Portfolio` struct field layout is unchanged. Add new `DataKey` variants to the `#[contracttype] enum DataKey` block in [`contracts/src/types.rs`](../../contracts/src/types.rs) — listed under "DataKey additions" below — before bumping the contract WASM.
- **DataKey additions (must land in `types.rs` before any new WASM deploys).**
  - `DataKey::ReconciliationState(portfolio_id)` — last `{last_sac_balance, last_ledger_balance, swept_at}` pair per portfolio (used by the dual-write reconciliation guard).
  - `DataKey::MigrationArmed` — single-shot `bool` flipped on by the admin immediately before any sweep; auto-cleared on completion.
  - `DataKey::DualWriteEnabled` — boolean controlling the dual-write window (legacy ledger *and* SAC transfer); unset by the next minor upgrade.
  - `DataKey::ReentrancyGuard` — set across every SAC-touching path inside `deposit`, `withdraw`, `execute_rebalance_internal`, and `migration_sweep`.
  Each of these is safe per [`docs/MIGRATION.md`](../MIGRATION.md) ("Add `DataKey` variant | Safe | No" row of the storage-compatibility table).

---

## Migration implications for existing portfolios

This is the most consequential section of this decision. Portfolios existing before the contract swap must be migrated without loss of user assets or fiduciary clarity.

### 1. Pre-migration inventory

- Snapshot every `DataKey::Portfolio(id)` entry by reading the portfolio table and its associated `DataKey::NavHistory(id)` series.
- Use `GET /api/v1/portfolios` (or the equivalent admin route) plus the on-chain event indexer to enumerate portfolio IDs. Do **not** rely on the off-chain `portfolios` SQL table alone; reconcile against [`contracts/src/lib.rs`](../../contracts/src/lib.rs) `get_portfolio`.
- Confirm the current SAC balance of each portfolio's assets at the **old** contract address. This baseline is essential for the sweep step.
- Place the old contract under `DataKey::EmergencyStop = true` via `set_emergency_stop(true)` and announce a freeze window.

### 2. Migration function pattern

Per [`docs/MIGRATION.md`](../MIGRATION.md), storage-shape changes require a migration function invoked inside `upgrade` before `update_current_contract_wasm`. The custody swap is implemented as:

1. Deploy the new WASM with the SAC-based `deposit` / `withdraw` / `rebalance` paths.
2. Run an `admin_migrate_portfolio` entry point (admin-auth, single-shot boolean `DataKey::MigrationArmed`) that, for each existing `Portfolio(id)`:
   - Reads SAC balance at the old contract address for every `asset` in `current_balances`.
   - Validates the SAC delta against the recorded internal ledger; pauses the portfolio with `PauseReason::AdminEmergency` if the delta is non-zero in the unsafe direction (claim suspected).
   - Performs a single SAC `transfer` from the *old* contract address to the *new* contract address (the old build must expose a `migration_sweep(asset, amount)` admin-only function).
   - Writes the new `DataKey::ReconciliationState(id)` with `{last_sac_balance: amount, last_ledger_balance: amount, swept_at: ledger_ts}`.
3. Records a `"portfolio","migrated"` event with `(old_contract: Address, new_contract: Address, portfolio_id: u64, timestamp: u64)`.

### 3. Capability and event-schema migration

- Bump `CONTRACT_EVENT_SCHEMA_VERSION` and `CONTRACT_VERSION` ([`contracts/src/types.rs`](../../contracts/src/types.rs)).
- Bump `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION` ([`backend/src/config/contractEventSchema.ts`](../../backend/src/config/contractEventSchema.ts)) and `FRONTEND_CONTRACT_SCHEMA_VERSION` ([`frontend/src/lib/contractCapabilities.ts`](../../frontend/src/lib/contractCapabilities.ts)) in lock-step.
- Add `CapabilityFlag::SacCustody = 1 << 3` so legacy deployments can be detected at runtime. Update [`docs/CONTRACT_CAPABILITY_MATRIX.md`](../CONTRACT_CAPABILITY_MATRIX.md) and the readout in [`frontend/src/App.tsx`](../../frontend/src/App.tsx) so the frontend falls back to read-only when `SacCustody` is absent.
- Update [`contracts/CONTRACT_ABI.md`](../../contracts/CONTRACT_ABI.md) to reflect the new `deposit` / `withdraw` / `execute_rebalance` signatures (the existing signatures remain ABI-compatible — the *semantics*, not arity, change).

### 4. Backend (PostgreSQL / SQLite)

- Add a new migration pair to [`backend/src/db/migrations/`](../../backend/src/db/migrations/) named with the **next sequential number after the existing migrations** (currently followed by `001_initial_schema`, `002_seed_demo_data`, and `006_rebalancing_strategy`; pick whichever `NNN` is the next free slot at implementation time, conventionally `NNN_sac_custody_model.up.sql` + `.down.sql`) with:
  - `ALTER TABLE portfolios ADD COLUMN custody_model VARCHAR(16) NOT NULL DEFAULT 'bookkeeping'` plus an enum constraint, and `ADD COLUMN migration_swept_at TIMESTAMPTZ NULL`.
  - Backfill: mark every existing row `custody_model = 'bookkeeping'`. After the on-chain sweep, flip to `'sac_custody'`.
- Update [`backend/src/services/databaseService.ts`](../../backend/src/services/databaseService.ts) so the SQLite `SCHEMA_SQL` matches.
- Update rebalance-plan, deposit, and withdraw API responses to expose `custody_model` for the frontend.

### 5. Frontend (graceful degradation)

- Extend the capability matrix (see [`docs/CONTRACT_CAPABILITY_MATRIX.md`](../CONTRACT_CAPABILITY_MATRIX.md)) and [`frontend/src/lib/contractCapabilities.ts`](../../frontend/src/lib/contractCapabilities.ts) with a `SacCustody` entry.
- In [`frontend/src/App.tsx`](../../frontend/src/App.tsx)'s `detectContractCapabilities`, treat a missing `SacCustody` flag as `warning`/`writes-blocked` rather than crash, surfacing the documented fallback to the user with a one-line migration prompt.
- Until migration completes, the deposit/withdraw actions are visually marked "Migration in progress — read-only".

### 6. Existing portfolio coexistence

Until the new contract is fully wired, we will run a **dual-write window** where:

- `deposit` writes both the SAC transfer *and* the existing ledger entry (so legacy indexers still reconcile).
- `withdraw` performs both, recommending users who already hold a booking to manually sweep.
- `execute_rebalance` keeps the existing `actual_balances` argument for one minor version, then deprecates it.

The dual-write window is controlled by `DataKey::DualWriteEnabled` and is unset by the next minor upgrade, after which the SAC balance is strictly authoritative.

---

## Security tradeoffs

We accept these tradeoffs explicitly. Each is paired with a concrete control so future audits can verify the mitigation is in place.

| Threat | Asset under Option A | Control |
| :--- | :--- | :--- |
| **Steward prints fake deposits** | Direct, since steward can call `deposit` and previously only mutates a map. | `deposit` now calls `token::Client::transfer` from `user → contract`. Steward can no longer credit value out of thin air. |
| **Slippage oracle spoofing** | High under Option B; mitigated by cross-checked SAC balance. | Reconcile the post-trade token balance at the contract address against `actual_balances` and bound drift. |
| **Malicious admin / upgrade** | Catastrophic under any model. | Multi-sig `admin`; `set_emergency_stop` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)); documented upgrade procedure in [`docs/CONTRACT_DEPLOYMENT_CHECKLIST.md`](../CONTRACT_DEPLOYMENT_CHECKLIST.md). |
| **Fee `transfer` revert** | Today: `execute_rebalance_internal` reverts with a SAC insufficient-balance error on the fee transfer because `deposit` never moves tokens. | Fixed by promoting `deposit`/`withdraw` to real SAC transfers; the fee transfer then has a non-zero balance to draw from. |
| **Reentrancy on `token::Client::transfer`** | Soroban host-side calls are mostly safe, but malicious SAC tokens could attempt callback reentrancy. | New `DataKey::ReentrancyGuard` set across every SAC-touching path. |
| **Migration desync** | A sweep that misses a portfolio leaves funds on the old contract. | Migration function step 2 enumerates every `DataKey::Portfolio(id)` and refuses to finalize unless each is reconciled; `PauseReason::AdminEmergency` is asserted as a precondition. |
| **DoS on relayer / RPC** | Not a custody concern, but matters for user perception of "safe". | Stale-price fallback already implemented per ADR 0002; the snapshot diff utility ([`scripts/snapshot-diff.mjs`](../../scripts/snapshot-diff.mjs)) lets an admin verify on-chain state by comparing replayed snapshots against expected state. |
| **Emergency pause after migration** | A paused contract freezes user funds. | Existing `pause_portfolio` + `set_emergency_stop` semantics; escalate by go-live with a `WITHRAWALS_HALT_GRACE_PERIOD_SECONDS` knob. |
| **Slippage policy version drift** | If a portfolio was created under an older `slippage_policy_version`, the new contract must accept it. | Already handled by `validate_slippage_policy_version` ([`contracts/src/portfolio.rs`](../../contracts/src/portfolio.rs)) plus `Error::UnsupportedSlippagePolicyVersion`. |

---

## Fallback and incident response

### If SAC is unreachable

- `deposit` and `withdraw` return `Error::StaleData` (current contract already returns this on a missing oracle; we extend the same pattern to SAC).
- The off-chain backend keeps the existing four-tier fallback (Reflector → CoinGecko → cache → synthetic) applied today for oracles, and exposes it as `DataKey::LastFallbackTier` so we can prove the rollback path in audits.
- Admins may issue `admin_force_rebalance` only after a manual reconciliation against the SAC balance at the contract address.

### If the migration sweep is interrupted mid-way

- Re-running the sweep is idempotent: `migration_sweep` checks the SAC balance → contract-address delta and only transfers the *remaining* difference.
- `PauseReason::AdminEmergency` is asserted before the return path so a half-migrated portfolio is not silently invokable.

### Incident playbooks

- Runbook is appended to [`docs/DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md) under a new section "Custody model incidents".
- The chaos script [`scripts/chaos/kill-backend-mid-rebalance.mjs`](../../scripts/chaos/kill-backend-mid-rebalance.mjs) is extended with `chaos/migration-interrupt.mjs` that stops the WASM upgrade mid-`update_current_contract_wasm`, so we rehearse the rollback path.

---

## Open questions

- **DEX aggregator choice during rebalance.** SAC custody makes the rebalance leg composable, but we are still choosing between a Soroban-native path (a path-payment call, see [`docs/soroban-cookbook.md`](../soroban-cookbook.md)) and a hosted-AMM adapter. ADR-0005 (or a follow-up ADR) will document that selection.
- **Gas budget per rebalance.** Multi-leg SAC + DEX calls blow past the current `REBALANCE_COOLDOWN_SECONDS = 3_600` ([`contracts/src/types.rs`](../../contracts/src/types.rs))) budget. Either raise the cooldown or split rebalances into staged legs; tracked as a follow-up.
- **Multi-sig admin deployment.** The contract accepts an arbitrary `admin` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs) `initialize`), so the operational policy (multi-sig, governance contract, or both) is decided out-of-band. Operations handbook entry to follow.
- **Fee configuration during migration.** `FeeConfig` ([`contracts/src/types.rs`](../../contracts/src/types.rs)) currently defaults to `enabled: false`. While the migration is mid-flight we keep fees disabled to avoid mid-sweep fee-transfer panics. The flip-on policy is a separate operations decision.

### Long-term follow-ups (not blocking this ADR)

- Publish a `custody_policy.md` consumer-facing doc (per-portfolio asset attestation snapshot).
- Update [`docs/QUEUE_WORKER_LIFECYCLE.md`](../QUEUE_WORKER_LIFECYCLE.md) and [`docs/QUEUE_OPERATIONS_WORKFLOW.md`](../QUEUE_OPERATIONS_WORKFLOW.md) so the queue worker routes SAC transfers end-to-end.
- Add a CLI helper [`scripts/sweep-portfolio.ts`](../../scripts/) that lists portfolios still on the bookkeeping model and emits per-portfolio SAC reconciliation diffs.

---

## References

- [`docs/adr/template.md`](template.md)
- [`docs/adr/0001-record-architecture-decisions.md`](0001-record-architecture-decisions.md)
- [`docs/adr/0002-reflector-oracle-selection.md`](0002-reflector-oracle-selection.md)
- [`docs/adr/README.md`](README.md)
- [`contracts/src/lib.rs`](../../contracts/src/lib.rs)
- [`contracts/src/types.rs`](../../contracts/src/types.rs)
- [`contracts/src/portfolio.rs`](../../contracts/src/portfolio.rs)
- [`contracts/src/nav.rs`](../../contracts/src/nav.rs)
- [`contracts/src/strategies/dca.rs`](../../contracts/src/strategies/dca.rs)
- [`contracts/src/upgrade.rs`](../../contracts/src/upgrade.rs)
- [`contracts/src/events.rs`](../../contracts/src/events.rs)
- [`contracts/CONTRACT_ABI.md`](../../contracts/CONTRACT_ABI.md)
- [`docs/CONTRACT_EVENTS.md`](../CONTRACT_EVENTS.md)
- [`docs/CONTRACT_CAPABILITY_MATRIX.md`](../CONTRACT_CAPABILITY_MATRIX.md)
- [`docs/CONTRACT_DEPLOYMENT_CHECKLIST.md`](../CONTRACT_DEPLOYMENT_CHECKLIST.md)
- [`docs/DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md)
- [`docs/MIGRATION.md`](../MIGRATION.md)
- [`docs/soroban-cookbook.md`](../soroban-cookbook.md)
- [`docs/REBALANCING_STRATEGIES.md`](../REBALANCING_STRATEGIES.md)
- [`backend/src/config/contractEventSchema.ts`](../../backend/src/config/contractEventSchema.ts)
- [`backend/src/services/databaseService.ts`](../../backend/src/services/databaseService.ts)
- [`backend/src/db/migrations/`](../../backend/src/db/migrations/)
- [`frontend/src/lib/contractCapabilities.ts`](../../frontend/src/lib/contractCapabilities.ts)
- [`frontend/src/App.tsx`](../../frontend/src/App.tsx)
- [`scripts/snapshot-diff.mjs`](../../scripts/snapshot-diff.mjs)
- [`scripts/chaos/kill-backend-mid-rebalance.mjs`](../../scripts/chaos/kill-backend-mid-rebalance.mjs)

# ADR 0004: Asset Custody / Token Transfer Model

## Status

Proposed

> Per [`docs/adr/README.md`](README.md) workflow, ADRs ship as **Proposed** at
> PR time and become **Accepted** once merged. This ADR is authored as
> **Proposed**; bump it to **Accepted** when the SAC-based custody contract
> is installed on the target network.

## Context

The Stellar Portfolio Rebalancer contract ([`PortfolioRebalancer`](../../contracts/src/lib.rs)) currently tracks portfolio holdings and rebalances using a mix of internal ledger mutation and a single off-chain reconciliation step. The contract exposes the familiar lifecycle entry points — `create_portfolio`, `deposit`, `withdraw`, `check_rebalance_needed`, `preview_rebalance`, `execute_rebalance`, plus related administrative surfaces — but its asset-transfer semantics are inconsistent and do not yet match the "real Stellar asset transfer" direction agreed for the project.

Concretely, the current on-chain behaviour is:

- `deposit` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)) increments `portfolio.current_balances` by `amount` but does **not** call `soroban_sdk::token::Client::transfer` to pull the asset into the contract. The same is true in the test suite: `client.deposit(&pid, &asset, &100, &String::from_str(&env, ""))` is purely an in-memory ledger update.
- `withdraw` decrements `portfolio.current_balances` but does **not** transfer the asset back to the user. The "withdraw" event is emitted after ledger mutation only.
- `execute_rebalance_internal` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)) iterates `preview.candidate_trades` and either adds or subtracts the trade amount from `portfolio.current_balances` *or* transfers the asset through `token::Client::transfer` for fee collection only. Slippage is checked against `actual_balances` supplied by the caller (the relayer/steward).
- The "actual" balances that drive the slippage envelope are read off-chain and passed in, but the contract never independently verifies that those balances reflect SAC state at the contract address.

The roles that exist today ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)) are `user` (owner), `steward` (delegated rebalancer, see `transfer_stewardship`), and `admin` (privileged operations, including `upgrade` and `set_emergency_stop`).

### Why a decision is needed now

1. The deposit / withdraw / fee-transfer triplet is internally inconsistent. Continuing to ship `deposit` as bookkeeping while `execute_rebalance_internal` performs a real `token::Client::transfer` for fees will revert with a SAC insufficient-balance error the moment fees are enabled on a portfolio whose balance was only ever recorded in the internal map ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)).
2. The "real Stellar asset transfer implementation" in flight needs a documented custody target. Without one, the new transfer paths cannot be authored against a stable contract.
3. The frontend/backend capability matrix ([`docs/CONTRACT_CAPABILITY_MATRIX.md`](../CONTRACT_CAPABILITY_MATRIX.md)) and event schema version ([`backend/src/config/contractEventSchema.ts`](../../backend/src/config/contractEventSchema.ts), [`frontend/src/lib/contractCapabilities.ts`](../../frontend/src/lib/contractCapabilities.ts)) need a known contract model to align against.
4. Existing portfolios (those created under the bookkeeping model) need a documented transition path. Without an ADR, migrated users risk balance desync or loss of fiduciary clarity.

### Decision criteria

We evaluate the three candidate custody models on:

- **Trust model & custody clarity.** Who legally holds the asset at each point in the lifecycle?
- **Slippage / MEV exposure.** Where is the trade decided, signed, and broadcast?
- **Slippage / oracle spoofing surface.** Can a malicious steward, oracle, or admin distort bookkeeping?
- **Operational complexity & gas profile.** Number of cross-contract invocations, CPU/memory pressure, DEX aggregator dependency.
- **Upgrade & emergency-stop semantics.** What happens if the contract is paused, upgrade-bugged, or its admin key is compromised?
- **Migration cost.** Field-level, storage footprint, event schema, backend, frontend, and existing-portfolio migration impact.

---

## Decision

We adopt **Contract-Held Custody via the Stellar Asset Contract (SAC)** as the unified asset-custody model. The Rebalancer contract becomes the custodian of user-supplied assets for the lifetime of a portfolio. All entry points that today mutate the internal `current_balances` map (`deposit`, `withdraw`, trade legs of `execute_rebalance`, and fee collection) will perform idempotent, auth-checked `soroban_sdk::token::Client::transfer` calls against the SAC of each managed asset.

The internal `current_balances` map is retained as an *indexed read-cache* and audit log keyed off SAC state, but it is no longer authoritative — the SAC contract balance held at the Rebalancer address is the source of truth. The contract will reconcile the index cache against the SAC at every entry point that mutates balances and will refuse to proceed if the cache drifts above a bounded tolerance (we call this the *reconciliation guarantee*).

### Comparison matrix

| Criterion | Option A — Contract-Held Custody (chosen) | Option B — Internal Bookkeeping (current) | Option C — User-Wallet Direct |
| :--- | :--- | :--- | :--- |
| **Custody clarity** | Rebalancer contract is unambiguous custodian. | Ambiguous — contract "tracks" balances the user holds elsewhere. | User retains self-custody; contract is a coordination layer only. |
| **Auth model** | One Soroban `require_auth()` per entry point; SAC `transfer` enforces payer authorization. | Steward can credit bookings without any on-chain proof of deposit. | User signs the exact Soroban auth payload for each trade. |
| **Slippage / MEV** | Sandbox path with min-out on DEX aggregator; rebalancer enforces slippage envelope. | Relayer-mediated; slippage check is post-hoc arithmetic only. | Strongest: each leg is co-signed with explicit price bounds. |
| **Bug blast radius** | Contract bug = drainable honeypot. Mitigated by emergency stop + upgrade + multisig admin. | Bug = balance desync between contract ledger and user's wallet. | Bug = users simply stop signing; capital never enters the contract. |
| **Gas profile (Soroban CPU)** | Highest — multiple SAC `transfer` and DEX invocations per rebalance. | Lowest — pure arithmetic + storage. | High — paid by user, per-leg auth verification. |
| **Operational complexity** | New ops burden (admin treasury, sweeping, SOC ops). | Lowest today, but fragile. | Requires Soroban `sponsor_*` auth patterns and fee-bump orchestration. |
| **Migration cost** | High one-time (sweep/V2 transition). | None today, but unsafe. | Highest (UX overhaul, signature flow rework). |

### Key rationale

- **Deterministic, on-chain provenance.** Every balance change is reconcilable against SAC state and the published event stream ([`contracts/CONTRACT_ABI.md`](../../contracts/CONTRACT_ABI.md), [`docs/CONTRACT_EVENTS.md`](../CONTRACT_EVENTS.md)).
- **Single point of audit.** Stewards, admins, and users all see the same source of truth — the SAC balance held at the Rebalancer address — so slippage disputes, fee accounting, and rebalance diffs become verifiable.
- **Aligns with Soroban primitives.** SAC is the canonical Stellar token interface; using `token::Client` is the only model the rest of the Soroban ecosystem composes against.
- **Already partially built.** `execute_rebalance_internal` already calls `token::Client::transfer` for fee collection ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)). Promoting the rest of the lifecycle to the same primitive eliminates the current state-machine inconsistency.
- **Compatible with staking, DCA, and fee strategies.** DCA ([`contracts/src/strategies/dca.rs`](../../contracts/src/strategies/dca.rs)) and the on-chain `FeeConfig` infrastructure ([`contracts/src/types.rs`](../../contracts/src/types.rs)) already assume a custodian-style contract; pairing them with real SAC transfers removes the current "ledger only" gap.

---

## Consequences

### Positive

- **Clear fiduciary model.** The contract is unambiguously the custodian during a portfolio's lifetime. Withdraw/sweep events match real on-chain value movements.
- **Deterministic slippage envelope.** `actual_balances` can be cross-checked against the SAC state at the contract address; off-chain relayers cannot falsify post-trade balances.
- **Composable with the rest of Soroban.** Other contracts (e.g. fee recipients, treasury, governance) can reason about Rebalancer-held assets without privileged off-chain data.
- **Eliminates the current inconsistency** between `deposit` (ledger only) and the fee `token::Client::transfer` call in `execute_rebalance_internal`.

### Negative

- **Honeypot risk.** A bug in the custodian contract could enable draining. Mitigations: multi-sig `admin` ([`contracts/src/types.rs`](../../contracts/src/types.rs)), `set_emergency_stop` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)), `pause_portfolio` (per-portfolio pause with `PauseReason`), and a hard time-locked upgrade path.
- **Reentrancy exposure.** `token::Client::transfer` is implemented in Soroban host space; cross-contract callbacks from malicious SAC implementations could attempt reentrancy. The contract already keys reentrancy-sensitive sections by `DataKey::EmergencyStop`. We will add a dedicated `DataKey::ReentrancyGuard` set across every SAC-touching path.
- **One-time migration complexity.** Existing portfolios created under the bookkeeping model must be swept to the new contract address.

### Neutral

- **Slightly higher gas.** Per `token::Client::transfer` call. We accept this as the cost of a clear custody model.
- **Storage footprint.** `Portfolio` struct field layout is unchanged. Add new `DataKey` variants to the `#[contracttype] enum DataKey` block in [`contracts/src/types.rs`](../../contracts/src/types.rs) — listed under "DataKey additions" below — before bumping the contract WASM.
- **DataKey additions (must land in `types.rs` before any new WASM deploys).**
  - `DataKey::ReconciliationState(portfolio_id)` — last `{last_sac_balance, last_ledger_balance, swept_at}` pair per portfolio (used by the dual-write reconciliation guard).
  - `DataKey::MigrationArmed` — single-shot `bool` flipped on by the admin immediately before any sweep; auto-cleared on completion.
  - `DataKey::DualWriteEnabled` — boolean controlling the dual-write window (legacy ledger *and* SAC transfer); unset by the next minor upgrade.
  - `DataKey::ReentrancyGuard` — set across every SAC-touching path inside `deposit`, `withdraw`, `execute_rebalance_internal`, and `migration_sweep`.
  Each of these is safe per [`docs/MIGRATION.md`](../MIGRATION.md) ("Add `DataKey` variant | Safe | No" row of the storage-compatibility table).

---

## Migration implications for existing portfolios

This is the most consequential section of this decision. Portfolios existing before the contract swap must be migrated without loss of user assets or fiduciary clarity.

### 1. Pre-migration inventory

- Snapshot every `DataKey::Portfolio(id)` entry by reading the portfolio table and its associated `DataKey::NavHistory(id)` series.
- Use `GET /api/v1/portfolios` (or the equivalent admin route) plus the on-chain event indexer to enumerate portfolio IDs. Do **not** rely on the off-chain `portfolios` SQL table alone; reconcile against [`contracts/src/lib.rs`](../../contracts/src/lib.rs) `get_portfolio`.
- Confirm the current SAC balance of each portfolio's assets at the **old** contract address. This baseline is essential for the sweep step.
- Place the old contract under `DataKey::EmergencyStop = true` via `set_emergency_stop(true)` and announce a freeze window.

### 2. Migration function pattern

Per [`docs/MIGRATION.md`](../MIGRATION.md), storage-shape changes require a migration function invoked inside `upgrade` before `update_current_contract_wasm`. The custody swap is implemented as:

1. Deploy the new WASM with the SAC-based `deposit` / `withdraw` / `rebalance` paths.
2. Run an `admin_migrate_portfolio` entry point (admin-auth, single-shot boolean `DataKey::MigrationArmed`) that, for each existing `Portfolio(id)`:
   - Reads SAC balance at the old contract address for every `asset` in `current_balances`.
   - Validates the SAC delta against the recorded internal ledger; pauses the portfolio with `PauseReason::AdminEmergency` if the delta is non-zero in the unsafe direction (claim suspected).
   - Performs a single SAC `transfer` from the *old* contract address to the *new* contract address (the old build must expose a `migration_sweep(asset, amount)` admin-only function).
   - Writes the new `DataKey::ReconciliationState(id)` with `{last_sac_balance: amount, last_ledger_balance: amount, swept_at: ledger_ts}`.
3. Records a `"portfolio","migrated"` event with `(old_contract: Address, new_contract: Address, portfolio_id: u64, timestamp: u64)`.

### 3. Capability and event-schema migration

- Bump `CONTRACT_EVENT_SCHEMA_VERSION` and `CONTRACT_VERSION` ([`contracts/src/types.rs`](../../contracts/src/types.rs)).
- Bump `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION` ([`backend/src/config/contractEventSchema.ts`](../../backend/src/config/contractEventSchema.ts)) and `FRONTEND_CONTRACT_SCHEMA_VERSION` ([`frontend/src/lib/contractCapabilities.ts`](../../frontend/src/lib/contractCapabilities.ts)) in lock-step.
- Add `CapabilityFlag::SacCustody = 1 << 3` so legacy deployments can be detected at runtime. Update [`docs/CONTRACT_CAPABILITY_MATRIX.md`](../CONTRACT_CAPABILITY_MATRIX.md) and the readout in [`frontend/src/App.tsx`](../../frontend/src/App.tsx) so the frontend falls back to read-only when `SacCustody` is absent.
- Update [`contracts/CONTRACT_ABI.md`](../../contracts/CONTRACT_ABI.md) to reflect the new `deposit` / `withdraw` / `execute_rebalance` signatures (the existing signatures remain ABI-compatible — the *semantics*, not arity, change).

### 4. Backend (PostgreSQL / SQLite)

- Add a new migration pair to [`backend/src/db/migrations/`](../../backend/src/db/migrations/) named with the **next sequential number after the existing migrations** (currently followed by `001_initial_schema`, `002_seed_demo_data`, and `006_rebalancing_strategy`; pick whichever `NNN` is the next free slot at implementation time, conventionally `NNN_sac_custody_model.up.sql` + `.down.sql`) with:
  - `ALTER TABLE portfolios ADD COLUMN custody_model VARCHAR(16) NOT NULL DEFAULT 'bookkeeping'` plus an enum constraint, and `ADD COLUMN migration_swept_at TIMESTAMPTZ NULL`.
  - Backfill: mark every existing row `custody_model = 'bookkeeping'`. After the on-chain sweep, flip to `'sac_custody'`.
- Update [`backend/src/services/databaseService.ts`](../../backend/src/services/databaseService.ts) so the SQLite `SCHEMA_SQL` matches.
- Update rebalance-plan, deposit, and withdraw API responses to expose `custody_model` for the frontend.

### 5. Frontend (graceful degradation)

- Extend the capability matrix (see [`docs/CONTRACT_CAPABILITY_MATRIX.md`](../CONTRACT_CAPABILITY_MATRIX.md)) and [`frontend/src/lib/contractCapabilities.ts`](../../frontend/src/lib/contractCapabilities.ts) with a `SacCustody` entry.
- In [`frontend/src/App.tsx`](../../frontend/src/App.tsx)'s `detectContractCapabilities`, treat a missing `SacCustody` flag as `warning`/`writes-blocked` rather than crash, surfacing the documented fallback to the user with a one-line migration prompt.
- Until migration completes, the deposit/withdraw actions are visually marked "Migration in progress — read-only".

### 6. Existing portfolio coexistence

Until the new contract is fully wired, we will run a **dual-write window** where:

- `deposit` writes both the SAC transfer *and* the existing ledger entry (so legacy indexers still reconcile).
- `withdraw` performs both, recommending users who already hold a booking to manually sweep.
- `execute_rebalance` keeps the existing `actual_balances` argument for one minor version, then deprecates it.

The dual-write window is controlled by `DataKey::DualWriteEnabled` and is unset by the next minor upgrade, after which the SAC balance is strictly authoritative.

---

## Security tradeoffs

We accept these tradeoffs explicitly. Each is paired with a concrete control so future audits can verify the mitigation is in place.

| Threat | Asset under Option A | Control |
| :--- | :--- | :--- |
| **Steward prints fake deposits** | Direct, since steward can call `deposit` and previously only mutates a map. | `deposit` now calls `token::Client::transfer` from `user → contract`. Steward can no longer credit value out of thin air. |
| **Slippage oracle spoofing** | High under Option B; mitigated by cross-checked SAC balance. | Reconcile the post-trade token balance at the contract address against `actual_balances` and bound drift. |
| **Malicious admin / upgrade** | Catastrophic under any model. | Multi-sig `admin`; `set_emergency_stop` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs)); documented upgrade procedure in [`docs/CONTRACT_DEPLOYMENT_CHECKLIST.md`](../CONTRACT_DEPLOYMENT_CHECKLIST.md). |
| **Fee `transfer` revert** | Today: `execute_rebalance_internal` reverts with a SAC insufficient-balance error on the fee transfer because `deposit` never moves tokens. | Fixed by promoting `deposit`/`withdraw` to real SAC transfers; the fee transfer then has a non-zero balance to draw from. |
| **Reentrancy on `token::Client::transfer`** | Soroban host-side calls are mostly safe, but malicious SAC tokens could attempt callback reentrancy. | New `DataKey::ReentrancyGuard` set across every SAC-touching path. |
| **Migration desync** | A sweep that misses a portfolio leaves funds on the old contract. | Migration function step 2 enumerates every `DataKey::Portfolio(id)` and refuses to finalize unless each is reconciled; `PauseReason::AdminEmergency` is asserted as a precondition. |
| **DoS on relayer / RPC** | Not a custody concern, but matters for user perception of "safe". | Stale-price fallback already implemented per ADR 0002; the snapshot diff utility ([`scripts/snapshot-diff.mjs`](../../scripts/snapshot-diff.mjs)) lets an admin verify on-chain state by comparing replayed snapshots against expected state. |
| **Emergency pause after migration** | A paused contract freezes user funds. | Existing `pause_portfolio` + `set_emergency_stop` semantics; escalate by go-live with a `WITHRAWALS_HALT_GRACE_PERIOD_SECONDS` knob. |
| **Slippage policy version drift** | If a portfolio was created under an older `slippage_policy_version`, the new contract must accept it. | Already handled by `validate_slippage_policy_version` ([`contracts/src/portfolio.rs`](../../contracts/src/portfolio.rs)) plus `Error::UnsupportedSlippagePolicyVersion`. |

---

## Fallback and incident response

### If SAC is unreachable

- `deposit` and `withdraw` return `Error::StaleData` (current contract already returns this on a missing oracle; we extend the same pattern to SAC).
- The off-chain backend keeps the existing four-tier fallback (Reflector → CoinGecko → cache → synthetic) applied today for oracles, and exposes it as `DataKey::LastFallbackTier` so we can prove the rollback path in audits.
- Admins may issue `admin_force_rebalance` only after a manual reconciliation against the SAC balance at the contract address.

### If the migration sweep is interrupted mid-way

- Re-running the sweep is idempotent: `migration_sweep` checks the SAC balance → contract-address delta and only transfers the *remaining* difference.
- `PauseReason::AdminEmergency` is asserted before the return path so a half-migrated portfolio is not silently invokable.

### Incident playbooks

- Runbook is appended to [`docs/DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md) under a new section "Custody model incidents".
- The chaos script [`scripts/chaos/kill-backend-mid-rebalance.mjs`](../../scripts/chaos/kill-backend-mid-rebalance.mjs) is extended with `chaos/migration-interrupt.mjs` that stops the WASM upgrade mid-`update_current_contract_wasm`, so we rehearse the rollback path.

---

## Open questions

- **DEX aggregator choice during rebalance.** SAC custody makes the rebalance leg composable, but we are still choosing between a Soroban-native path (a path-payment call, see [`docs/soroban-cookbook.md`](../soroban-cookbook.md)) and a hosted-AMM adapter. ADR-0005 (or a follow-up ADR) will document that selection.
- **Gas budget per rebalance.** Multi-leg SAC + DEX calls blow past the current `REBALANCE_COOLDOWN_SECONDS = 3_600` ([`contracts/src/types.rs`](../../contracts/src/types.rs))) budget. Either raise the cooldown or split rebalances into staged legs; tracked as a follow-up.
- **Multi-sig admin deployment.** The contract accepts an arbitrary `admin` ([`contracts/src/lib.rs`](../../contracts/src/lib.rs) `initialize`), so the operational policy (multi-sig, governance contract, or both) is decided out-of-band. Operations handbook entry to follow.
- **Fee configuration during migration.** `FeeConfig` ([`contracts/src/types.rs`](../../contracts/src/types.rs)) currently defaults to `enabled: false`. While the migration is mid-flight we keep fees disabled to avoid mid-sweep fee-transfer panics. The flip-on policy is a separate operations decision.

### Long-term follow-ups (not blocking this ADR)

- Publish a `custody_policy.md` consumer-facing doc (per-portfolio asset attestation snapshot).
- Update [`docs/QUEUE_WORKER_LIFECYCLE.md`](../QUEUE_WORKER_LIFECYCLE.md) and [`docs/QUEUE_OPERATIONS_WORKFLOW.md`](../QUEUE_OPERATIONS_WORKFLOW.md) so the queue worker routes SAC transfers end-to-end.
- Add a CLI helper [`scripts/sweep-portfolio.ts`](../../scripts/) that lists portfolios still on the bookkeeping model and emits per-portfolio SAC reconciliation diffs.

---

## References

- [`docs/adr/template.md`](template.md)
- [`docs/adr/0001-record-architecture-decisions.md`](0001-record-architecture-decisions.md)
- [`docs/adr/0002-reflector-oracle-selection.md`](0002-reflector-oracle-selection.md)
- [`docs/adr/README.md`](README.md)
- [`contracts/src/lib.rs`](../../contracts/src/lib.rs)
- [`contracts/src/types.rs`](../../contracts/src/types.rs)
- [`contracts/src/portfolio.rs`](../../contracts/src/portfolio.rs)
- [`contracts/src/nav.rs`](../../contracts/src/nav.rs)
- [`contracts/src/strategies/dca.rs`](../../contracts/src/strategies/dca.rs)
- [`contracts/src/upgrade.rs`](../../contracts/src/upgrade.rs)
- [`contracts/src/events.rs`](../../contracts/src/events.rs)
- [`contracts/CONTRACT_ABI.md`](../../contracts/CONTRACT_ABI.md)
- [`docs/CONTRACT_EVENTS.md`](../CONTRACT_EVENTS.md)
- [`docs/CONTRACT_CAPABILITY_MATRIX.md`](../CONTRACT_CAPABILITY_MATRIX.md)
- [`docs/CONTRACT_DEPLOYMENT_CHECKLIST.md`](../CONTRACT_DEPLOYMENT_CHECKLIST.md)
- [`docs/DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md)
- [`docs/MIGRATION.md`](../MIGRATION.md)
- [`docs/soroban-cookbook.md`](../soroban-cookbook.md)
- [`docs/REBALANCING_STRATEGIES.md`](../REBALANCING_STRATEGIES.md)
- [`backend/src/config/contractEventSchema.ts`](../../backend/src/config/contractEventSchema.ts)
- [`backend/src/services/databaseService.ts`](../../backend/src/services/databaseService.ts)
- [`backend/src/db/migrations/`](../../backend/src/db/migrations/)
- [`frontend/src/lib/contractCapabilities.ts`](../../frontend/src/lib/contractCapabilities.ts)
- [`frontend/src/App.tsx`](../../frontend/src/App.tsx)
- [`scripts/snapshot-diff.mjs`](../../scripts/snapshot-diff.mjs)
- [`scripts/chaos/kill-backend-mid-rebalance.mjs`](../../scripts/chaos/kill-backend-mid-rebalance.mjs)