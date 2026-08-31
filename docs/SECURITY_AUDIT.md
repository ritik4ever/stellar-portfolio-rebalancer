# Security Audit â€” stellar-portfolio-rebalancer

This document records security findings identified during internal and external audits of the
`stellar-portfolio-rebalancer` smart contract. Each entry includes a description, impact
assessment, reproduction steps, recommended remediation, and current status.

---

## Findings Index

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| [SPR-001](#spr-001) | `get_fee_config` default `fee_recipient` falls back to the contract's own address | **High** | Open — fix tracked in #1519 |
| [SPR-002](#spr-002) | Unbounded `create_portfolio` allows storage-spam DoS | **Medium** | Open — mitigation recommended |

---

## SPR-001

**Title:** `get_fee_config` default `fee_recipient` falls back to the contract's own address

**Severity:** High

**Status:** Open â€” remediation required (tracked in issue #1519)

**Reported:** 2026-07-27

**Affected file:** `contracts/src/lib.rs`

**Affected function:** `get_fee_config` (line ~404), `execute_rebalance_internal`

---

### Description

`get_fee_config` returns an in-memory default `FeeConfig` when no fee configuration has been
stored in contract storage. The default value hardcodes `fee_recipient` to
`env.current_contract_address()` â€” the contract's own address:

```rust
// contracts/src/lib.rs
pub fn get_fee_config(env: Env) -> FeeConfig {
    env.storage()
        .instance()
        .get(&DataKey::FeeConfig)
        .unwrap_or(FeeConfig {
            platform_name: String::from_str(&env, ""),
            fee_bps: 0,
            fee_recipient: env.current_contract_address(), // â†� self-referential default
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
| **Funds at risk** | Yes â€” any fee-denominated token amount sent to the contract address is permanently unrecoverable without an upgrade |
| **Requires admin action to trigger** | Yes â€” `enabled: false` in the default prevents automatic triggering today |
| **Exploitable by external actor** | No â€” fee collection only runs inside `execute_rebalance_internal`, which requires steward auth |
| **Scope of affected deployments** | All deployments where `set_fee_config` has not been called before fee collection is enabled |
| **Recoverability** | None without a contract upgrade that adds a sweep function |

---

### Recommended Remediation

Two complementary fixes are required. Both should be delivered together.

#### Fix 1 â€” Remove the unsafe default recipient (required)

Replace the self-referential fallback in `get_fee_config` with a value that cannot silently
route funds anywhere. The safest approach is to make the absence of a stored config
unambiguously "fees disabled" at the type level:

**Option A â€” Panic on access when not configured (strictest):**

```rust
pub fn get_fee_config(env: Env) -> FeeConfig {
    env.storage()
        .instance()
        .get(&DataKey::FeeConfig)
        .expect("FeeConfig not initialised; call set_fee_config before enabling fees")
}
```

**Option B â€” Return a disabled sentinel with no recipient (recommended):**

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

#### Fix 2 â€” Add an admin fee sweep / withdrawal function (defence in depth)

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
the contract is not in emergency stop â€” or alternatively, only when emergency stop is active,
depending on the operator's threat model.

#### Fix 3 â€” Require explicit fee recipient in `initialize` (optional hardening)

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

### References

- Issue: [#1519 â€” Security audit: set_fee_config default recipient defaults to contract's own address](../../issues/1519)
- Affected code: [`contracts/src/lib.rs` â€” `get_fee_config`](../contracts/src/lib.rs)
- Affected code: [`contracts/src/lib.rs` â€” `execute_rebalance_internal`](../contracts/src/lib.rs)
- Soroban token interface: https://developers.stellar.org/docs/smart-contracts/tokens

---

*Last updated: 2026-07-27*
*Audited by: Kiro (automated security review, issue #1519)*

---

## SPR-002

**Title:** Unbounded `create_portfolio` allows storage-spam DoS

**Severity:** Medium

**Status:** Open — mitigation recommended

**Reported:** 2026-08-31

**Affected file:** `contracts/src/lib.rs`

**Affected function:** `create_portfolio`, `create_portfolio_with_strategy`, `create_portfolio_from_template`

---

### Description

Currently, the `stellar-portfolio-rebalancer` contract does not restrict how many portfolios can be created globally or across multiple accounts. While a per-user cap is being tracked separately, an attacker could still circumvent this by generating numerous unique accounts and calling `create_portfolio` (or its variants) from each one.

Each new portfolio increments the global `NextPortfolioId` and writes a new `Portfolio` struct to `persistent` storage via `DataKey::PortfolioV2(portfolio_id)`. 

### Storage-Rent and Cost Implications

In Soroban, persistent storage entries require a minimum rent. While the invoker of `create_portfolio` pays the transaction fees and initial storage rent, the long-term rent burden falls on the contract or requires ongoing community effort to bump the ledger entries to prevent them from being archived. 

If an attacker aggressively spams portfolio creation:
1. **Ledger Bloat & Rent Costs:** It increases the storage footprint of the contract significantly. Keeping these entries alive (if necessary for global state operations) will consume excessive rent fees.
2. **Archival DoS Risk:** If the contract relies on querying active portfolios (e.g., via off-chain indexers or future on-chain aggregations) or if the sheer volume of data makes RPC queries expensive, it degrades system performance. If entries are archived, unarchiving them incurs additional costs.
3. **ID Exhaustion:** While a `u64` is unlikely to wrap around, a massive number of portfolios might hit theoretical limits or cause issues for off-chain systems indexing `NextPortfolioId`.

### Recommended Mitigation

To prevent storage-spam and unbounded creation of portfolios, we recommend implementing a multi-layered defense:

1. **Per-Account Cap (Cross-Reference):** Enforce a strict limit on the number of portfolios a single user can create (this is currently being tracked separately as a per-user cap issue).
2. **Minimum Balance / Fee Requirement (Recommended):** Require users to deposit a minimum balance of a supported asset into the portfolio upon creation, or charge a non-refundable protocol fee in XLM or USDC for each `create_portfolio` call. This imposes a direct economic cost on the attacker, effectively neutralizing sybil-based spam.
3. **Admin-Configurable Global Cap (Defense in Depth):** Add a `max_global_portfolios` configuration setting that the admin can adjust. If the global limit is reached, new creations are paused until the admin evaluates the system's capacity and raises the limit.