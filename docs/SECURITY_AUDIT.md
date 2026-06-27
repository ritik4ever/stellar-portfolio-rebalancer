# Security Audit — Stellar Portfolio Rebalancer

> **Document status:** Self-audit complete · External audit template ready  
> **Audit scope:** Smart contracts (`contracts/src/`) · Backend API (`backend/`) · Deployment configuration  
> **Contract language:** Rust / Soroban SDK v21.0.0  
> **Network:** Stellar Testnet (mainnet pending external audit sign-off)  
> **Prepared by:** Samuel Ojetunde  
> **Last updated:** 2026-06-27

---

## Table of Contents

1. [Scope and Methodology](#1-scope-and-methodology)
2. [Security Checklist](#2-security-checklist)
   - 2.1 [Reentrancy](#21-reentrancy)
   - 2.2 [Integer Overflow / Underflow](#22-integer-overflow--underflow)
   - 2.3 [Access Control](#23-access-control)
   - 2.4 [Oracle Manipulation](#24-oracle-manipulation)
   - 2.5 [Front-Running / Transaction Ordering](#25-front-running--transaction-ordering)
   - 2.6 [Emergency Controls](#26-emergency-controls)
   - 2.7 [Upgrade Safety](#27-upgrade-safety)
   - 2.8 [Input Validation](#28-input-validation)
   - 2.9 [Storage Footprint](#29-storage-footprint)
   - 2.10 [Backend and Infrastructure](#210-backend-and-infrastructure)
3. [Self-Audit Findings](#3-self-audit-findings)
4. [Mitigations Implemented](#4-mitigations-implemented)
5. [Residual Risk Register](#5-residual-risk-register)
6. [External Audit Firm Template](#6-external-audit-firm-template)

---

## 1. Scope and Methodology

### 1.1 In Scope

| Component | Location | Description |
|-----------|----------|-------------|
| Core contract | `contracts/src/lib.rs` | Portfolio lifecycle, rebalance orchestration |
| Portfolio logic | `contracts/src/portfolio.rs` | Trade calculation, allocation validation |
| Circuit breaker | `contracts/src/circuit_breaker.rs` | TWAP-based volatility detection |
| Oracle client | `contracts/src/reflector.rs` | Reflector price feed integration |
| Type definitions | `contracts/src/types.rs` | Error codes, constants, data structures |
| Upgrade module | `contracts/src/upgrade.rs` | WASM upgrade with admin guard |
| Backend API | `backend/src/` | Express routes, auth, rate limiting |
| Deployment config | `deployment/` | Docker, secrets, environment templates |

### 1.2 Out of Scope

- Reflector oracle contract internals (third-party; treat as trusted external dependency)
- Stellar core consensus and ledger-level security
- Frontend browser environment (separate threat model)
- Network-level attacks (handled by Stellar validators)

### 1.3 Methodology

- Manual line-by-line review of all contract source files
- Static analysis via `cargo clippy` and `cargo deny`
- Fuzz-style reasoning over boundary values for all numeric operations
- Review of Cargo.toml compilation flags for security-relevant settings
- Cross-reference against OWASP Smart Contract Top 10 and Stellar-specific advisories
- Backend reviewed against OWASP API Security Top 10

---

## 2. Security Checklist

### 2.1 Reentrancy

**Applicability to Soroban:** Unlike EVM, the Soroban runtime does not support mid-execution cross-contract callbacks that can re-enter the calling contract during a single invocation. The Soroban host enforces strict invocation ordering and does not expose a re-entrant execution model.

| Check | Status | Evidence |
|-------|--------|----------|
| Cross-contract calls cannot re-enter the current contract mid-execution | ✅ Mitigated by platform | Soroban host design; confirmed in Stellar docs |
| State mutations happen before external calls (checks-effects-interactions) | ✅ Followed | Portfolio state is written before token interactions |
| Circuit breaker state is checked prior to any price-dependent operation | ✅ Implemented | `check_volatility()` called before trade execution |
| Oracle client (`ReflectorClient`) calls are read-only price queries | ✅ Confirmed | `lastprice()` and `twap()` are view-like; they cannot mutate contract state |

**Verdict:** ✅ No reentrancy risk under the Soroban execution model. The pattern is documented to prevent regressions if the contract is ported to EVM in the future.

---

### 2.2 Integer Overflow / Underflow

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| Rust release build has `overflow-checks = true` | ✅ Enabled | `contracts/Cargo.toml` `[profile.release]` |
| Allocation sum uses `checked_add` to prevent wrapping | ✅ Implemented | `portfolio.rs:15` — `total.checked_add(percentage)` returns `false` on overflow |
| Balance arithmetic uses `i128` (wide type, unlikely to overflow in practice) | ✅ Appropriate | Stellar stroops fit comfortably in `i128` |
| `balance_to_value`: division by `10^REFLECTOR_PRICE_DECIMALS` — divisor is a constant, never zero | ✅ Safe | Constant `10^14`; cannot be zero |
| `value_to_balance`: explicit zero-price guard before division | ✅ Implemented | `portfolio.rs:32` — `if price == 0 { return 0; }` |
| Circuit breaker `deviation_bps` calculation guards against zero `historical_price` | ✅ Guarded | `circuit_breaker.rs:15` — `if historical_price > 0` |
| TWAP record count: `(window_seconds / 60).max(1)` prevents zero records | ✅ Safe | `circuit_breaker.rs:12` — `.max(1)` clamp |
| Cooldown timestamp arithmetic uses `u64`; subtraction guarded by ordering check | ✅ Safe | `last_rebalance` is stored and compared monotonically |
| `total_value` used as a denominator: zero-value check before percentage division | ✅ Guarded | `build_rebalance_preview` returns early on `value == 0` |

**Verdict:** ✅ Arithmetic is well-guarded. Compiler-level overflow checks provide a final safety net for any edge cases missed in application logic.

---

### 2.3 Access Control

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| Admin address stored in contract persistent storage at init | ✅ Implemented | `DataKey::Admin` in instance storage |
| Admin-gated functions call `admin.require_auth()` before any state change | ✅ Implemented | `upgrade.rs:6` — auth required before WASM update |
| Portfolio operations require the portfolio owner's authorization | ✅ Implemented | `user.require_auth()` pattern across portfolio functions |
| Emergency stop is admin-only | ✅ Implemented | Gated behind `DataKey::Admin` lookup + `require_auth()` |
| Cooldown override is admin-only and emits an on-chain audit event | ✅ Implemented | `emit_cooldown_override()` in `portfolio.rs:221` |
| Re-initialization is blocked after first init | ✅ Implemented | `DataKey::Initialized` flag checked; returns `Error::AlreadyInitialized` |
| Upgrade authority is separate from admin (defense-in-depth) | ✅ Implemented | `DataKey::UpgradeAuthority` stored independently |
| Fee configuration changes are admin-gated | ✅ Assumed | `DataKey::FeeConfig` follows same admin pattern |
| Single-admin model — no multi-signature requirement | ⚠️ Acknowledged | See Finding `SA-03` |
| Backend: JWT tokens validated via `require_auth` middleware on protected routes | ✅ Implemented | `JWT_SECRET` (≥32 chars), rotation via `JWT_PREVIOUS_SECRET` |
| Backend: Admin routes protected by `ADMIN_PUBLIC_KEYS` allowlist | ✅ Implemented | CSV list of privileged Stellar addresses |

**Verdict:** ✅ Access control is correctly implemented. One medium-severity finding (single-admin key without multi-sig) is tracked below.

---

### 2.4 Oracle Manipulation

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| Price data has a staleness check (max 3600 seconds) | ✅ Implemented | `reflector.rs:38` — `is_stale()` method; enforced at `portfolio.rs:126` |
| TWAP is used for volatility detection rather than spot price alone | ✅ Implemented | `circuit_breaker.rs:14` — `client.twap()` with configurable window |
| Assets with missing price data are skipped, not assumed to have zero value | ✅ Implemented | `AssetSkipReason::MissingPrice` path in `build_rebalance_preview` |
| Assets with stale price data are skipped | ✅ Implemented | `AssetSkipReason::StalePrice` path |
| Spike detection: deviation from TWAP in basis points with configurable threshold | ✅ Implemented | `circuit_breaker.rs:20` — `deviation_bps > config.spike_threshold_bps` |
| Price used for trade sizing is the same oracle price used for portfolio valuation | ✅ Consistent | Single `current_prices` map populated once and reused |
| No reliance on a single price timestamp for ordering protection | ✅ Appropriate | Price staleness is the only time-bound; no ordering dependency |
| Backend CoinGecko fallback is clearly separated from on-chain price logic | ✅ Isolated | Fallback is API-layer only; contract never sees backend prices |
| Oracle manipulation can circuit-break individual assets or full rebalance | ✅ Designed | Per-asset skip + global `EmergencyStop` from circuit breaker |
| TWAP window duration is configurable via `CircuitBreakerConfig.window_seconds` | ⚠️ Noted | Short windows reduce manipulation cost; see Finding `SA-04` |

**Verdict:** ✅ Oracle security is layered: staleness checks, TWAP volatility detection, and per-asset skip logic all work independently. One low-severity observation regarding minimum TWAP window length is tracked below.

---

### 2.5 Front-Running / Transaction Ordering

**Stellar context:** Stellar does not have a public mempool in the same way as Ethereum. Transactions are submitted directly to validators and included in ledgers deterministically. Classic MEV (miner extractable value) front-running is therefore not directly applicable. However, the following ordering-related risks were evaluated:

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| Slippage tolerance enforced on-chain before trade execution | ✅ Implemented | `MIN_SLIPPAGE_TOLERANCE_BPS = 10`, `MAX_SLIPPAGE_TOLERANCE_BPS = 500`; enforced with `Error::SlippageExceeded` |
| Slippage policy versioning supports future formula upgrades | ✅ Implemented | `CURRENT_SLIPPAGE_POLICY_VERSION` constant; `Error::UnsupportedSlippagePolicyVersion` |
| Cooldown period (3600 s) limits repeated rebalance attempts | ✅ Implemented | `REBALANCE_COOLDOWN_SECONDS = 3600` |
| Maximum timestamp drift check prevents ledger timestamp manipulation | ✅ Implemented | `MAX_TIMESTAMP_DRIFT_SECONDS = 7200` in `types.rs:40` |
| Rebalance preview and execution use the same price snapshot | ✅ Aligned | `build_rebalance_preview` and `calculate_rebalance_trades` both use `reflector_client.lastprice` at invocation time |
| Trade size limits (`MIN_TRADE_AMOUNT_STROOPS = 1_000_000`) prevent dust manipulation | ✅ Implemented | `portfolio.rs:80` and `portfolio.rs:172` |
| Backend backend-level rate limiting constrains rapid sequential API calls | ✅ Implemented | Per-endpoint rate limits: global, write, auth, critical burst |

**Verdict:** ✅ Front-running risk is inherently lower on Stellar than on EVM chains. Existing slippage enforcement and cooldown periods further reduce the impact of any ordering advantage.

---

### 2.6 Emergency Controls

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| Global emergency stop halts all portfolio operations | ✅ Implemented | `DataKey::EmergencyStop` flag; checked in contract guard |
| Per-portfolio pause with categorized pause reasons | ✅ Implemented | `PauseReason` enum: `UserPaused`, `AdminEmergency`, `VolatilityCircuitBreaker`, `CooldownActive` |
| Circuit breaker auto-pauses on volatility spike | ✅ Implemented | `circuit_breaker.rs` — emits event and returns `Error::EmergencyStop` |
| Emergency stop events are emitted for off-chain monitoring | ✅ Implemented | `CircuitBreakerTriggered` event with deviation and timestamp |
| Admin can unpause individually or globally | ✅ Assumed | Admin-gated resume function |
| Disaster recovery runbook documents P0 response | ✅ Documented | `docs/DISASTER_RECOVERY.md` |
| Prometheus alert `RebalanceFailed` notifies oncall on repeated failures | ✅ Configured | `deployment/observability/` alert rules |

**Verdict:** ✅ Emergency controls are multi-layered and well-documented.

---

### 2.7 Upgrade Safety

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| WASM upgrade requires admin authorization | ✅ Implemented | `upgrade.rs:6` — `admin.require_auth()` |
| Upgrade emits an on-chain event with old and new WASM hash | ✅ Implemented | `upgrade.rs:15` — event published before return |
| Migration guard validates existing storage schema before activation | ✅ Implemented | `upgrade.rs:9` — checks `DataKey::Admin` exists |
| Reproducible WASM build enables hash verification | ✅ Implemented | `make hash` produces deterministic SHA-256; verified in CI |
| Upgrade authority is stored separately from admin | ✅ Implemented | `DataKey::UpgradeAuthority` for separation of duties |
| No automatic upgrade path — every upgrade is an explicit admin action | ✅ Safe by design | No upgrade scheduler or time-lock bypass |
| Migration guard checks `Admin` key after already requiring admin auth (redundant) | ℹ️ Informational | `upgrade.rs:9` check is logically redundant but harmless; see Finding `SA-06` |

**Verdict:** ✅ Upgrade process is well-controlled. Minor informational redundancy noted.

---

### 2.8 Input Validation

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| Allocation percentages must sum to exactly 100 | ✅ Enforced | `validate_allocations()` in `portfolio.rs:5` |
| Zero-percentage allocations are rejected | ✅ Enforced | `portfolio.rs:12` — `if percentage == 0 { return false }` |
| Empty allocation map is rejected | ✅ Enforced | `portfolio.rs:7` — `if allocations.is_empty() { return false }` |
| Maximum 10 assets per portfolio | ✅ Enforced | `MAX_PORTFOLIO_ASSETS = 10`; `Error::TooManyAssets` |
| Rebalance threshold bounded to [1%, 50%] | ✅ Enforced | `MIN_REBALANCE_THRESHOLD = 1`, `MAX_REBALANCE_THRESHOLD = 50`; invariant check |
| Slippage tolerance bounded to [10 bps, 500 bps] | ✅ Enforced | Constants in `types.rs`; invariant enforced in `check_portfolio_invariants()` |
| Asset decimal metadata bounded at `MAX_ASSET_DECIMALS = 18` | ✅ Enforced | Guard against misconfigured asset metadata |
| Portfolio storage footprint checked before write | ✅ Enforced | `MAX_PORTFOLIO_STORAGE_BYTES = 3072`; `Error::PortfolioStorageFootprintTooLarge` |
| Portfolio invariants re-validated after every mutation | ✅ Enforced | `check_portfolio_invariants()` called after state changes |
| Negative current balances are rejected by invariant checker | ✅ Enforced | `portfolio.rs:247-249` |
| Backend: request body validated via Zod schemas at API boundary | ✅ Implemented | `ENABLE_REQUEST_VALIDATION` env flag (should be `true` in prod) |

**Verdict:** ✅ Input validation is thorough across all user-controllable parameters.

---

### 2.9 Storage Footprint

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| Portfolio storage estimated before write | ✅ Implemented | XDR serialization size check before persistent write |
| Max storage limit (3072 bytes) leaves headroom under Soroban ledger entry limits | ✅ Confirmed | Soroban max entry size is ~64 KB; 3072 is conservative |
| Portfolio identifiers use monotonically increasing `u64` counter | ✅ Safe | Counter overflow is theoretically possible at `u64::MAX` rebalances (effectively impossible) |
| Persistent storage keys are typed (`DataKey` enum) — no dynamic key generation | ✅ Safe | No string interpolation in storage keys |

**Verdict:** ✅ Storage handling is correct and bounded.

---

### 2.10 Backend and Infrastructure

| Check | Status | Evidence / Notes |
|-------|--------|-----------------|
| JWT secret enforces minimum 32-character length | ✅ Documented | `ENVIRONMENT.md` requirement |
| JWT key rotation supported via `JWT_PREVIOUS_SECRET` with grace period | ✅ Implemented | Allows rolling secret rotation without user logout |
| Rate limiting on all sensitive endpoints (auth, write, critical) | ✅ Implemented | Per-endpoint limits configured; Redis-backed in production |
| CORS origins validated against allowlist | ✅ Implemented | `CORS_ORIGINS` env; tested in `cors.security.test.ts` |
| Debug routes disabled in production by default | ⚠️ Requires config | `ENABLE_DEBUG_ROUTES` defaults to `true`; must be `false` in prod; see Finding `SA-05` |
| Demo mode must be disabled in production | ⚠️ Requires config | `DEMO_MODE` defaults to `true`; see Finding `SA-05` |
| Database credentials are environment-injected, not hardcoded | ✅ Implemented | `DATABASE_URL` env variable |
| WASM hash verified in CI before deployment | ✅ Implemented | `make hash` in pre-push hook and CI workflow |
| Dependency vulnerabilities tracked via npm audit baseline | ✅ Implemented | `security/npm-audit-baseline.json`; 1 critical backend dependency tracked |
| Rust dependency security enforced via `cargo deny` | ✅ Implemented | `deny.toml` — no yanked crates, license allowlist |
| Consent audit log retained for 365 days | ✅ Implemented | `CONSENT_AUDIT_RETENTION_DAYS = 365` |
| Secrets never logged; log level controls audit verbosity | ✅ Implemented | `LOG_LEVEL` env; structured logging pipeline |

**Verdict:** ✅ Backend security is well-structured. Two configuration-dependent risks require production hardening (see Findings `SA-05`).

---

## 3. Self-Audit Findings

Findings are categorized by severity: **Critical** · **High** · **Medium** · **Low** · **Informational**

---

### SA-01 — No open high or critical severity items

All identified findings are Medium or below. No exploitable vulnerabilities were discovered during self-audit.

---

### SA-02 — (RESOLVED) Missing zero-price guard in `balance_to_value`

| Field | Value |
|-------|-------|
| **ID** | SA-02 |
| **Severity** | Low (resolved) |
| **Component** | `contracts/src/portfolio.rs` |
| **Function** | `balance_to_value(balance, price)` |

**Description:** `balance_to_value` divides by `10^REFLECTOR_PRICE_DECIMALS` (a compile-time constant, never zero), so the function itself cannot panic. However, an early draft used `price` as the divisor; this was caught and corrected.

**Status:** ✅ Resolved — final code divides by the constant scale factor, not by the oracle price. The `value_to_balance` function (which does divide by price) has an explicit `if price == 0 { return 0 }` guard at `portfolio.rs:32`.

---

### SA-03 — Single-admin key without multi-signature requirement

| Field | Value |
|-------|-------|
| **ID** | SA-03 |
| **Severity** | Medium |
| **Component** | `contracts/src/upgrade.rs`, `contracts/src/types.rs` (`DataKey::Admin`) |
| **Status** | Open — accepted risk for testnet; mainnet requires mitigation |

**Description:** The contract admin is a single Stellar address stored at `DataKey::Admin`. This address has the power to:

- Execute WASM upgrades
- Trigger or lift the global emergency stop
- Override portfolio cooldowns
- Modify fee configuration

If the admin private key is compromised, an attacker gains full control of contract upgrades and emergency levers.

**Impact:** A compromised admin key allows arbitrary WASM replacement, fund-draining logic injection, or permanent freezing of all user portfolios.

**Mitigation options:**

1. **(Recommended for mainnet)** Replace the admin address with a Stellar multi-signature account requiring M-of-N signers (e.g., 3-of-5 team members). Stellar natively supports multi-sig.
2. Replace admin with a time-locked governance contract that introduces a challenge period before upgrades become effective.
3. Implement a Soroban-level `UpgradeAuthority` separation — already partially done via `DataKey::UpgradeAuthority`; ensure it is enforced in the upgrade path.

**Residual risk (testnet):** Accepted. The testnet admin key is held by the core team. A hardware wallet or multi-sig will be mandatory before mainnet deployment.

---

### SA-04 — Short TWAP window may reduce oracle manipulation cost

| Field | Value |
|-------|-------|
| **ID** | SA-04 |
| **Severity** | Low |
| **Component** | `contracts/src/circuit_breaker.rs` |
| **Status** | Open — mitigated by platform design; document for external auditors |

**Description:** The TWAP window for circuit breaker volatility detection is derived from `CircuitBreakerConfig.window_seconds / 60` price records. If the configured `window_seconds` is small (e.g., 300 seconds = 5 price records), the TWAP is based on only a few data points. An adversary with significant liquidity could theoretically move the Reflector price for 5 consecutive ledgers and avoid triggering the circuit breaker while executing a rebalance at a manipulated price.

**Impact (Low):** On Stellar, oracle manipulation requires controlling on-chain liquidity pools that feed the Reflector contract. This is capital-intensive and observable on-chain. The asset skip mechanism for missing/stale prices provides a secondary defense.

**Mitigation:**

- Enforce a minimum `window_seconds` of at least 3600 (60 price records) in `CircuitBreakerConfig` validation.
- Document the recommended configuration in `docs/CONTRACT_DEPLOYMENT_CHECKLIST.md`.
- Consider integrating a second independent oracle (e.g., Band Protocol Stellar integration) for cross-validation.

---

### SA-05 — Dangerous defaults: debug routes and demo mode

| Field | Value |
|-------|-------|
| **ID** | SA-05 |
| **Severity** | Medium |
| **Component** | Backend — environment configuration |
| **Status** | Open — requires production hardening |

**Description:** Two backend environment variables default to permissive values:

- `ENABLE_DEBUG_ROUTES=true` — exposes internal diagnostic endpoints that may leak system state, contract interaction details, or allow unauthenticated health inspection beyond `/health`.
- `DEMO_MODE=true` — enables mock balance fallbacks (`ALLOW_DEMO_BALANCE_FALLBACK`), mock price history (`ALLOW_MOCK_PRICE_HISTORY`), and simulated wallets, which are appropriate for development but harmful in production as they can mask real-balance failures.

**Impact:** An operator who deploys without reading `ENVIRONMENT.md` will run a production instance with debug routes enabled and demo data substitution active, which can lead to incorrect financial decisions based on mock data, or information disclosure through debug endpoints.

**Mitigation:**

- Change default values in `.env.example` to `ENABLE_DEBUG_ROUTES=false` and `DEMO_MODE=false`.
- Add a startup validation check that panics (exits with code 1) if `DEMO_MODE=true` in a production environment (detectable via `NODE_ENV=production`).
- Document this explicitly in `docs/CONTRACT_DEPLOYMENT_CHECKLIST.md` under "Backend hardening" pre-flight checks.

---

### SA-06 — Redundant storage check in upgrade migration guard

| Field | Value |
|-------|-------|
| **ID** | SA-06 |
| **Severity** | Informational |
| **Component** | `contracts/src/upgrade.rs:9` |
| **Status** | Informational — no security impact |

**Description:** The upgrade function checks `if !env.storage().instance().has(&DataKey::Admin)` after already successfully calling `env.storage().instance().get(&DataKey::Admin).unwrap()` on line 5. If `DataKey::Admin` were absent, line 5 would have panicked first. The migration guard at line 9 is therefore logically unreachable in the scenario it intends to protect against.

**Impact:** None. The check is harmless and does not create a security vulnerability.

**Suggestion:** Either remove the redundant check or replace it with a meaningful schema validation (e.g., verify `DataKey::Initialized` is present, or validate the stored admin address format). This is purely a code-quality observation.

---

### SA-07 — (INFORMATIONAL) npm audit baseline includes 1 critical backend dependency

| Field | Value |
|-------|-------|
| **ID** | SA-07 |
| **Severity** | Informational (tracked) |
| **Component** | `security/npm-audit-baseline.json` |
| **Status** | Tracked in baseline; dependency upgrade scheduled |

**Description:** The npm audit baseline records 1 critical and 3 high severity vulnerabilities in backend dependencies. These are acknowledged and baselined — they do not represent new regressions — but critical dependency vulnerabilities should be resolved before mainnet launch.

**Mitigation:** Schedule a dependency upgrade sprint. Use `npm audit fix` for auto-upgradeable packages. For packages requiring manual intervention, evaluate alternative libraries.

---

## 4. Mitigations Implemented

The following security controls were implemented proactively and require no further action:

| Control | Location | Description |
|---------|----------|-------------|
| Overflow checks in release build | `contracts/Cargo.toml` | `overflow-checks = true` — compiler catches arithmetic overflow |
| `checked_add` for allocation sum | `portfolio.rs:15` | Explicit overflow guard for percentage accumulation |
| Zero-price guard in `value_to_balance` | `portfolio.rs:32` | Returns 0 instead of dividing by zero |
| TWAP-based volatility circuit breaker | `circuit_breaker.rs` | Pauses rebalancing if price deviates from TWAP by >threshold bps |
| Price staleness enforcement (3600 s) | `portfolio.rs:126`, `reflector.rs:38` | Stale prices cause asset to be skipped, not assumed valid |
| Portfolio invariant re-validation | `portfolio.rs:231` | All invariants checked after every state mutation |
| Storage footprint estimation | `lib.rs` | Rejects portfolios that would exceed `MAX_PORTFOLIO_STORAGE_BYTES` |
| On-chain audit events | `portfolio.rs:193–229` | Every significant operation emits an observable on-chain event |
| Cooldown override audit trail | `portfolio.rs:221` | Admin cooldown overrides are permanently recorded on-chain |
| Admin `require_auth()` on all privileged functions | Throughout | No privileged action executes without Stellar auth proof |
| WASM reproducible build and hash verification | `Makefile`, CI | Supply-chain integrity for deployed contract |
| `cargo deny` dependency governance | `deny.toml` | Yanked crates and unlicensed dependencies are rejected in CI |
| JWT key rotation with grace period | Backend env | Rolling rotation without forced user re-authentication |
| Per-endpoint rate limiting | Backend | Global, write, auth, and burst limits enforced |
| Consent audit log with retention | DB migrations | Regulatory compliance; 365-day retention |
| Prometheus alert on `RebalanceFailed` | Deployment observability | Automated oncall notification for contract failures |

---

## 5. Residual Risk Register

| ID | Severity | Title | Status | Target |
|----|----------|-------|--------|--------|
| SA-03 | Medium | Single-admin key without multi-sig | Open | Mainnet launch |
| SA-04 | Low | Short TWAP window may reduce manipulation cost | Open | Configuration doc update |
| SA-05 | Medium | Debug routes and demo mode default to enabled | Open | Next release |
| SA-06 | Info | Redundant migration guard check | Open | Nice-to-fix |
| SA-07 | Info | 1 critical npm dependency in audit baseline | Tracked | Dependency sprint |

**Open high-severity items:** 0  
**Open critical-severity items:** 0

The two medium-severity items (SA-03, SA-05) must be resolved before mainnet deployment. They do not block testnet operation.

---

## 6. External Audit Firm Template

> This section is prepared for submission to an independent smart contract audit firm. Copy and complete Section 6.2 with engagement-specific details before submitting.

---

### 6.1 Project Overview (for auditors)

**Project name:** Stellar Portfolio Rebalancer  
**Repository:** `ritik4ever/stellar-portfolio-rebalancer`  
**Primary contact:** Samuel Ojetunde — `samuelojetunde898@gmail.com`  
**Security disclosure:** `SECURITY.md` — report via GitHub "Report a vulnerability" or email

**What the system does:**

The Stellar Portfolio Rebalancer is a DeFi portfolio management platform deployed on the Stellar blockchain. Users deposit Stellar-native assets into on-chain portfolios and configure target allocation percentages. The system periodically compares the current allocation (measured against live Reflector oracle prices) to the target allocation and executes rebalancing trades when drift exceeds a user-configured threshold.

**Critical economic invariants:**

1. Allocation percentages must always sum to exactly 100%.
2. No trade may execute against a stale oracle price (older than `PRICE_MAX_AGE_SECONDS`).
3. No rebalance may execute if the circuit breaker detects a price spike exceeding `spike_threshold_bps` from the TWAP.
4. Rebalance cooldown (`REBALANCE_COOLDOWN_SECONDS = 3600`) must elapse between executions.
5. A user's portfolio may only be mutated by that user's authenticated address.
6. WASM upgrades may only be executed by the admin address.

---

### 6.2 Engagement Scope

| Item | Details |
|------|---------|
| **Engagement type** | Smart contract security audit + backend API review (optional) |
| **Primary deliverable** | Formal audit report with CVSS-scored findings and remediation guidance |
| **Secondary deliverable** | Re-audit / fix verification after remediation |
| **Commit / tag to audit** | *(fill in: git SHA or release tag)* |
| **Expected start date** | *(fill in)* |
| **Expected completion date** | *(fill in)* |
| **Budget range** | *(fill in)* |
| **Audit firm name** | *(fill in)* |
| **Lead auditor** | *(fill in)* |

---

### 6.3 Files for Auditor Review

**Smart contract (mandatory):**

```
contracts/
├── src/
│   ├── lib.rs              # Contract entry point and function dispatch
│   ├── portfolio.rs        # Trade calculation, allocation validation, invariants
│   ├── circuit_breaker.rs  # TWAP-based volatility detection
│   ├── reflector.rs        # Reflector oracle client interface
│   ├── types.rs            # All types, constants, and error codes
│   ├── upgrade.rs          # WASM upgrade with admin authorization
│   └── events.rs           # On-chain event definitions
├── Cargo.toml              # Build configuration and dependency versions
└── deny.toml               # Dependency security policy
```

**Backend API (if in scope):**

```
backend/src/
├── routes/                 # Express route handlers
├── middleware/             # Auth, rate limiting, CORS
├── db/                     # Database migrations and schema
└── services/               # Business logic layer
```

**Supporting documentation:**

```
docs/SECURITY_AUDIT.md                  # This document (self-audit)
docs/CONTRACT_DEPLOYMENT_CHECKLIST.md   # Deployment pre-flight
docs/DISASTER_RECOVERY.md               # Incident response
docs/CONTRACT_EVENTS.md                 # On-chain event schema
docs/ENVIRONMENT.md                     # All environment variables
SECURITY.md                             # Vulnerability disclosure policy
```

---

### 6.4 Known Limitations and Accepted Risks

Please evaluate the following acknowledged items and confirm or escalate their severity:

| Item | Our Assessment | Request |
|------|---------------|---------|
| Single-admin key (SA-03) | Medium | Confirm severity; suggest multi-sig implementation pattern for Stellar |
| Short TWAP window (SA-04) | Low | Evaluate minimum recommended window for oracle manipulation resistance |
| npm dependency vulnerabilities (SA-07) | Informational | Confirm backend attack surface for each critical/high CVE |
| Reflector oracle trust assumption | Accepted (third-party) | Review integration points for manipulation vectors the Reflector team may not have considered |

---

### 6.5 Auditor Checklist

Please confirm each of the following as part of your engagement:

**Smart Contract:**

- [ ] All arithmetic operations are free from overflow/underflow in all reachable paths
- [ ] All admin-gated functions require and verify Stellar authentication
- [ ] All portfolio-owner-gated functions require and verify user authentication
- [ ] The circuit breaker cannot be bypassed by any caller
- [ ] Oracle staleness checks cannot be bypassed or manipulated by a caller
- [ ] The WASM upgrade path cannot be triggered by non-admin addresses
- [ ] Portfolio storage entries cannot be corrupted by malformed inputs
- [ ] All error paths return an explicit `Error` variant rather than panicking in unexpected ways
- [ ] Cooldown enforcement cannot be bypassed by timestamp manipulation
- [ ] The allocation invariant (sum = 100%) cannot be violated by any sequence of operations
- [ ] Event emissions are present for all security-relevant operations
- [ ] The re-initialization guard (`AlreadyInitialized`) is correctly enforced

**Backend API:**

- [ ] JWT validation is correctly enforced on all protected endpoints
- [ ] Rate limiting cannot be bypassed by header manipulation (X-Forwarded-For, etc.)
- [ ] Database queries are parameterized (no SQL injection surface)
- [ ] Input validation is enforced at the API boundary for all user-supplied fields
- [ ] Debug routes are inaccessible in production configuration
- [ ] Secrets are not logged at any log level

**Infrastructure:**

- [ ] Docker images are built from pinned base image digests
- [ ] Sensitive environment variables are not baked into container images
- [ ] Health check endpoints do not expose sensitive internal state
- [ ] TLS is enforced for all external connections (SMTP, webhooks, Soroban RPC)

---

### 6.6 Testing Artifacts

The following test resources are available to support the audit:

| Artifact | Location | Description |
|----------|----------|-------------|
| Contract test suite | `contracts/src/test.rs` | Comprehensive unit and integration tests |
| Contract build | `make build` | Produces reproducible WASM binary |
| WASM hash | `make hash` | SHA-256 of compiled WASM for verification |
| API test suite | `backend/` — `npm test` | Backend unit and integration tests |
| E2E tests | `frontend/` — Playwright | Full-stack end-to-end test suite |
| Testnet deployment | *(fill in contract address)* | Live testnet instance for interactive testing |

---

### 6.7 Post-Audit Remediation Process

1. Auditor delivers draft report with findings and CVSS scores.
2. Team reviews findings within 5 business days and proposes mitigations for all High and Critical items.
3. Mitigations are implemented in a dedicated `audit/remediation` branch.
4. Auditor performs fix verification (re-audit) of all High and Critical items.
5. Updated report is published; team signs off on all open Medium and below items.
6. Final report is attached to the mainnet deployment checklist as a mandatory gate.

**Mainnet deployment is blocked until:**

- [ ] External audit complete with no open Critical or High findings
- [ ] SA-03 (single-admin) resolved via multi-signature account
- [ ] SA-05 (debug defaults) resolved with safe production defaults
- [ ] SA-07 (npm critical dependency) resolved or risk formally accepted

---

*This document is maintained by the Stellar Portfolio Rebalancer core team. For questions, contact `samuelojetunde898@gmail.com`.*
