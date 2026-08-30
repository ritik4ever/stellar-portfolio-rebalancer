# Security Audit — stellar-portfolio-rebalancer

This document records security findings identified during internal and external audits of the
`stellar-portfolio-rebalancer` smart contract. Each entry includes a description, impact
assessment, reproduction steps, recommended remediation, and current status.

---

## Findings Index

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| [SPR-001](#spr-001) | `get_fee_config` default `fee_recipient` falls back to the contract's own address | **High** | Open — fix tracked in #1519 |
| [SPR-002](#spr-002) | Idempotency key predictability & cross-user collision threat model | **Medium** | Remediated — scoped by user session |
| [SPR-003](#spr-003) | Re-entrancy risk assessment of external Reflector oracle calls in rebalance | **Low** | Verified — CEI pattern enforced |

---

## SPR-001

**Title:** `get_fee_config` default `fee_recipient` falls back to the contract's own address

**Severity:** High

**Status:** Open — remediation required (tracked in issue #1519)

**Reported:** 2026-07-27

**Affected file:** `contracts/src/lib.rs`

**Affected function:** `get_fee_config` (line ~404), `execute_rebalance_internal`

---

### Description

`get_fee_config` returns an in-memory default `FeeConfig` when no fee configuration has been
stored in contract storage. The default value hardcodes `fee_recipient` to
`env.current_contract_address()` — the contract's own address:

```rust
// contracts/src/lib.rs
pub fn get_fee_config(env: Env) -> FeeConfig {
    env.storage()
        .instance()
        .get(&DataKey::FeeConfig)
        .unwrap_or(FeeConfig {
            platform_name: String::from_str(&env, ""),
            fee_bps: 0,
            fee_recipient: env.current_contract_address(), // ← self-referential default
            enabled: false,
        })
}
```

`initialize` does not write a `FeeConfig` entry to storage, so this fallback is active on
every freshly deployed contract until `set_fee_config` is explicitly called.

`execute_rebalance_internal` calls `get_fee_config` and, when `fee_config.enabled` is `true`
and `fee_bps > 0`, executes a token transfer directly to `fee_config.fee_recipient`:

```rust
if fee_amount > 0 {
    let token_client = token::Client::new(env, &asset);
    token_client.transfer(
        &env.current_contract_address(),
        &fee_config.fee_recipient, // could be the contract itself
        &fee_amount,
    );
}
```

There is **no `fee_withdraw`, `admin_sweep`, or any other mechanism** in the codebase that
allows recovery of tokens held at the contract's own address. Any fees sent there are
permanently stranded.

---

### Attack / Misconfiguration Scenario

The default `enabled: false` and `fee_bps: 0` prevent fee collection in the out-of-the-box
state, so the vulnerability does not trigger automatically. However, the unsafe default
creates a critical trap under the following conditions:

1. **Operator misconfiguration:** An admin enables fee collection via `set_fee_config` but a
   future contract upgrade or storage reset clears the stored `FeeConfig`. Rebalances
   subsequently execute against the fallback default. If the new default is consumed with
   `enabled: true` in any refactor, fees flow to the contract address immediately.

2. **Unsafe fallback as a code smell:** The contract currently guards execution with
   `enabled: false` in the default, but this is a fragile, implicit safeguard. Any future
   developer who changes the default `enabled` field to `true` (e.g., to simplify
   platform-level fee activation) will silently strand every fee collected until the
   misconfiguration is caught.

3. **Storage manipulation / upgrade path risk:** If a contract upgrade initialises storage
   differently, or if a migration script inadvertently clears `DataKey::FeeConfig`, the
   unsafe self-recipient default becomes live with no warning.

4. **No recovery path:** Because Soroban contracts cannot arbitrarily transfer tokens they
   hold without an explicit withdrawal function, and no such function exists, stranded fees
   are unrecoverable without a contract upgrade.

---

### Impact

| Dimension | Assessment |
|-----------|-----------|
| **Funds at risk** | Yes — any fee-denominated token amount sent to the contract address is permanently unrecoverable without an upgrade |
| **Requires admin action to trigger** | Yes — `enabled: false` in the default prevents automatic triggering today |
| **Exploitable by external actor** | No — fee collection only runs inside `execute_rebalance_internal`, which requires steward auth |
| **Scope of affected deployments** | All deployments where `set_fee_config` has not been called before fee collection is enabled |
| **Recoverability** | None without a contract upgrade that adds a sweep function |

---

### Recommended Remediation

Two complementary fixes are required. Both should be delivered together.

#### Fix 1 — Remove the unsafe default recipient (required)

Replace the self-referential fallback in `get_fee_config` with a value that cannot silently
route funds anywhere. The safest approach is to make the absence of a stored config
unambiguously "fees disabled" at the type level:

**Option A — Panic on access when not configured (strictest):**

```rust
pub fn get_fee_config(env: Env) -> FeeConfig {
    env.storage()
        .instance()
        .get(&DataKey::FeeConfig)
        .expect("FeeConfig not initialised; call set_fee_config before enabling fees")
}
```

**Option B — Return a disabled sentinel with no recipient (recommended):**

Introduce an `Option<Address>` for `fee_recipient`, or use a dedicated
`fee_config_is_set: bool` flag in storage, so that the execution path can detect
"not configured" and skip fee collection entirely without relying on `enabled: false` in a
fallback struct:

```rust
pub fn get_fee_config(env: Env) -> Option<FeeConfig> {
    env.storage().instance().get(&DataKey::FeeConfig)
}
```

In `execute_rebalance_internal`:

```rust
let fee_config = Self::get_fee_config(env.clone());
let effective_fee_bps = match &fee_config {
    Some(c) if c.enabled => c.fee_bps,
    _ => 0,
};
```

This eliminates the unsafe default entirely. Fee collection is off unless a `FeeConfig` is
explicitly stored.

#### Fix 2 — Add an admin fee sweep / withdrawal function (defence in depth)

Even with Fix 1 applied, add a recovery path so that any tokens inadvertently sent to the
contract address can be retrieved:

```rust
pub fn admin_sweep_token(env: Env, token: Address, amount: i128, destination: Address) {
    require_admin(&env);
    let token_client = token::Client::new(&env, &token);
    token_client.transfer(&env.current_contract_address(), &destination, &amount);
    env.events().publish(
        (Symbol::new(&env, "admin_sweep"),),
        (token, amount, destination, env.ledger().timestamp()),
    );
}
```

This function should require admin auth, emit an auditable event, and be callable only when
the contract is not in emergency stop — or alternatively, only when emergency stop is active,
depending on the operator's threat model.

#### Fix 3 — Require explicit fee recipient in `initialize` (optional hardening)

Add `fee_recipient: Option<Address>` to `initialize` so that deployments must declare an
intent at construction time:

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    reflector_address: Address,
    fee_recipient: Option<Address>,
) -> Result<(), Error> {
    // ... existing init logic ...
    if let Some(recipient) = fee_recipient {
        env.storage().instance().set(&DataKey::FeeConfig, &FeeConfig {
            platform_name: String::from_str(&env, ""),
            fee_bps: 0,
            fee_recipient: recipient,
            enabled: false,
        });
    }
    Ok(())
}
```

This is backward-compatible (recipient is optional) and makes the deployment checklist
explicit rather than relying on operators running `set_fee_config` post-deploy.

---

### Verification

After applying the fix:

1. Deploy a fresh contract without calling `set_fee_config`.
2. Call `execute_rebalance` with a non-zero fee configuration via direct storage inspection.
3. Confirm no fee transfer occurs (or the function returns an error / skips fee collection).
4. Call `set_fee_config` with `enabled: true`, a valid `fee_bps`, and an explicit external
   `fee_recipient`.
5. Call `execute_rebalance` and confirm the fee is routed to the external recipient, not the
   contract address.
6. Add a unit test asserting `get_fee_config` with no stored value returns `None` (or
   equivalent sentinel) rather than a self-referential struct.

---

## SPR-002

**Title:** Idempotency key predictability & cross-user collision threat model

**Severity:** Medium

**Status:** Remediated — scoped by authenticated user / session (tracked in issue #1315)

**Reported:** 2026-07-24

**Affected file:** `backend/src/services/idempotencyRedisStore.ts`, `backend/src/middleware/idempotency.ts`

**Affected component:** REST API Idempotency Layer

---

### Description

A threat model assessment was conducted on how idempotency keys are generated, stored, and evaluated across concurrent API operations in `idempotencyRedisStore.ts`. 

Without strict user/tenant scoping, client-supplied `Idempotency-Key` headers (e.g. UUIDv4 or sequential identifiers) could create cross-user collision and replay vulnerabilities if two clients submit the same key concurrently or if a malicious actor guesses an active key.

---

### Attack / Collision Scenario

1. **Cross-user collision / response leakage:** If Redis keys are stored purely as `idempotency:<key>`, an unauthenticated or malicious user submitting the same key as another user could receive cached transaction details, portfolio IDs, or execution receipts belonging to the other account.
2. **Denial of Service (Pre-emption):** An adversary could poll or pre-populate idempotency keys in Redis with pending lock status, preventing legitimate users from executing rebalances or trades.

---

### Remediation & Verified Mitigations

1. **Scoped Storage Keys:** All Redis keys are strictly namespaced using composite identifiers:
   ```typescript
   const redisKey = `idempotency:${authenticatedUserId}:${clientProvidedKey}`;
   ```
2. **Payload Digest Verification:** A SHA-256 hash of the request body, method, and route path is stored alongside the key. If an identical key is reused with differing payloads, a `422 Unprocessable Entity / 409 Conflict` error is returned rather than returning stale cached responses.
3. **Atomic Set-NX Lock with TTL:** Uses Redis atomic `SET key lock NX EX <ttl>` to prevent concurrent race conditions during inflight processing.

---

### References

- Issue: [#1315 — [SECURITY] Security: threat-model idempotency key handling](../../issues/1315)
- Affected code: [`backend/src/services/idempotencyRedisStore.ts`](../backend/src/services/idempotencyRedisStore.ts)
- Affected code: [`backend/src/middleware/idempotency.ts`](../backend/src/middleware/idempotency.ts)

---

## SPR-003

**Title:** Security review: re-entrancy risk of external Reflector calls in rebalance

**Severity:** Low

**Status:** Verified — Checks-Effects-Interactions pattern enforced (tracked in issue #1316)

**Reported:** 2026-07-24

**Affected file:** `contracts/src/portfolio.rs`, `contracts/src/lib.rs`, `contracts/src/circuit_breaker.rs`

**Affected function:** `execute_rebalance_internal`, `check_volatility`

---

### Description

A focused security analysis evaluated external cross-contract call ordering during portfolio rebalancing. Specifically, the contract invokes the external Reflector oracle (`reflector_client.twap` and price feeds) and executes token transfers via the Soroban Token Interface.

---

### Threat Model & Worst-Case Scenario Analysis

1. **Re-entrancy Attempt via Malicious Oracle:** A malicious or compromised oracle contract returning price data could theoretically attempt to call back into `execute_rebalance`, `deposit`, or `withdraw` during the oracle price fetch phase.
2. **Worst-Case Impact:** If state updates (such as updating last rebalance timestamps, allocations, or emergency stop flags) occurred *after* external calls without re-entrancy protection, an attacker could trigger duplicate trades or bypass slippage/circuit breaker thresholds.

---

### Verified Architecture & Defense-in-Depth

1. **Checks-Effects-Interactions (CEI):** All parameter validations, emergency stop checks, and internal state checks occur before executing external token transfers.
2. **Soroban Re-entrancy Guard Architecture:** Soroban's execution environment restricts uncontrolled cross-contract re-entrancy by default unless explicit auth context is re-established.
3. **Circuit Breaker Immediate State Mutation:** In `check_volatility`, whenever volatility exceeds `spike_threshold_bps`, `DataKey::EmergencyStop` and `DataKey::ContractPauseReason` are immediately set in storage *prior* to returning the error and aborting execution.

---

### References

- Issue: [#1316 — [SECURITY] Security review: re-entrancy risk of external Reflector calls in rebalance](../../issues/1316)
- Affected code: [`contracts/src/portfolio.rs`](../contracts/src/portfolio.rs)
- Affected code: [`contracts/src/circuit_breaker.rs`](../contracts/src/circuit_breaker.rs)
- Affected code: [`contracts/src/lib.rs`](../contracts/src/lib.rs)

---

*Last updated: 2026-08-30*
*Audited by: wheval (automated security review & threat modeling, issues #1315, #1316)*

