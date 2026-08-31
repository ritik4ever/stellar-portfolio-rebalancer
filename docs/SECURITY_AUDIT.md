# Security Audit — stellar-portfolio-rebalancer

This document records security findings identified during internal and external audits of the
`stellar-portfolio-rebalancer` smart contract. Each entry includes a description, impact
assessment, reproduction steps, recommended remediation, and current status.

---

## Findings Index

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| [SPR-001](#spr-001) | `get_fee_config` default `fee_recipient` falls back to the contract's own address | **High** | Open — fix tracked in #1519 |
| [SPR-002](#spr-002) | `debug.routes.ts` diagnostic endpoints exposure risk in production | **Medium-High** | Remediated — gated via feature flag & admin auth (#1314) |

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

**Title:** `debug.routes.ts` diagnostic endpoints exposure risk in production

**Severity:** Medium-High

**Status:** Remediated — gated via feature flag & admin authentication (issue #1314)

**Reported:** 2026-08-31

**Affected file:** `backend/src/api/debug.routes.ts`

**Affected endpoints:**
- `POST /debug/notifications/test`
- `GET /debug/coingecko-test`
- `GET /debug/force-fresh-prices`
- `GET /debug/reflector-test`
- `GET /debug/env`
- `GET /debug/auto-rebalancer-test`

---

### Description

The `debug.routes.ts` router exposes diagnostic and developer utility endpoints under `/api/debug/*` (and `/api/v1/debug/*`). These endpoints provide internal observability and debugging capabilities for oracle price feeds, notification dispatch, runtime environment parameters, and the auto-rebalancing worker.

If exposed in production without multi-layered access controls, these endpoints present significant security risks including:
1. **Unsafe Actions & State Mutation:** Active cache eviction that forces immediate external requests, and arbitrary trigger of notification delivery pipelines.
2. **Denial of Service & Quota Exhaustion:** Cache thrashing against Reflector oracles and third-party CoinGecko API quotas.
3. **Internal State & Reconnaissance Leaks:** Disclosure of internal service status, active portfolio counts, runtime environment flags, and oracle connectivity details.
4. **Credential & Secret Exposure:** Potential exposure of third-party API keys, bearer tokens, user contact info (emails/webhooks), and environment secrets.

---

### Route-by-Route Exposure & Risk Assessment

| Endpoint | HTTP Method | Assigned Severity | Primary Risk & Potential Impact | Data Disclosed |
|---|---|---|---|---|
| `/debug/notifications/test` | `POST` | **Medium** | **Unsafe Action & Abuse:** Triggers live notification dispatch to user email/webhook/telegram. Risk of outbound notification spam, infrastructure resource consumption, and SSRF against internal services via user-supplied webhook URLs. | Masked recipient metadata (`email`, `webhook`) |
| `/debug/coingecko-test` | `GET` | **High** | **Quota Depletion & Proxy Abuse:** Proxies live requests to CoinGecko using server-configured API keys (`COINGECKO_API_KEY`). Unrestricted access could exhaust paid API tiers or be abused as an open outbound proxy. | HTTP response status and raw CoinGecko pricing JSON |
| `/debug/force-fresh-prices` | `GET` | **High** | **Unsafe State Mutation & DoS:** Clears in-memory/Redis price caches (`reflectorService.clearCache()`) and forces synchronous re-fetching from upstream oracles. Repeated calls cause cache stampedes, elevated latency for active rebalancing workflows, and upstream rate limiting. | Fresh price map, oracle feed metadata, cache status |
| `/debug/reflector-test` | `GET` | **Medium** | **Reconnaissance & Oracle Probing:** Executes live oracle connectivity health checks and returns cache statistics alongside environment metadata. Aids attackers in fingerprinting infrastructure state. | Oracle connectivity status, cache operational metrics, `nodeEnv`, `apiKeySet` flag |
| `/debug/env` | `GET` | **Low-Medium** | **Runtime Information Disclosure:** Discloses runtime `NODE_ENV`, auto-rebalancer initialization flag, and execution loop state. | `environment`, `autoRebalancerEnabled`, `autoRebalancerRunning` |
| `/debug/auto-rebalancer-test` | `GET` | **Medium** | **Operational Metrics & DB Load:** Queries database for total portfolio count (`portfolioStorage.getPortfolioCount()`) and returns execution statistics and scheduler status. | Portfolio counts, rebalancer execution stats, operational timestamps |

---

### Defense-in-Depth Analysis

Security of debug routes is structured as a multi-tier defense-in-depth model:

```
[ Incoming Request ]
         │
         ▼
 ┌────────────────────────────────────────────────────────┐
 │ Layer 1: Feature Flag Gate (blockDebugInProduction)    │
 │ Checks ENABLE_DEBUG_ROUTES (default: false)            │
 │ Rejects with 404 Not Found to prevent route discovery   │
 └───────────────────────┬────────────────────────────────┘
                         │ (if enabled)
                         ▼
 ┌────────────────────────────────────────────────────────┐
 │ Layer 2: Admin Signature Auth (requireAdmin)           │
 │ Validates ed25519 signature + timestamp + admin key    │
 │ Rejects with 401 Unauthorized / 403 Forbidden          │
 └───────────────────────┬────────────────────────────────┘
                         │ (if authorized)
                         ▼
 ┌────────────────────────────────────────────────────────┐
 │ Layer 3: Request Validation & Rate Limiting            │
 │ Zod schema validation + IP/Admin rate limiters         │
 └───────────────────────┬────────────────────────────────┘
                         │ (if valid)
                         ▼
 ┌────────────────────────────────────────────────────────┐
 │ Layer 4: Execution & Response Redaction (redactObject) │
 │ Deeply masks secrets, keys, emails, and webhooks       │
 └────────────────────────────────────────────────────────┘
```

#### Cross-Reference with Feature-Flag Gating

The `ENABLE_DEBUG_ROUTES` feature flag (evaluated in `backend/src/middleware/debugGate.ts` via `blockDebugInProduction`) serves as the perimeter switch:
- **Default Value:** `false` across all environments (`featureFlags.ts`), ensuring safe-by-default behavior.
- **Fail-Closed Design:** Returns HTTP `404 Not Found` rather than `401` or `403` when disabled, preventing route enumeration and fingerprinting by unauthorized scanners.

**Why Feature-Flag Gating Alone Is Insufficient:**
Relying solely on environment toggles represents a single point of failure:
1. **Accidental Enablement:** Staging or production environments utilizing shared `.env` files or misconfigured `FEATURE_FLAGS_FILE` overrides could inadvertently enable the flag.
2. **Environment Variable Injection:** Compromised container configuration or developer testing overrides could expose raw diagnostic endpoints to the public internet.
3. **No Per-User Identity:** Feature flags are binary and process-wide; they do not distinguish between trusted administrators, normal users, or external attackers.

Therefore, **mandatory cryptographic signature authentication (`requireAdmin`) is enforced on all debug endpoints** alongside flag gating.

---

### Recommended Hardening Measures

To achieve enterprise-grade defense in depth, the following hardening measures are documented and recommended:

#### 1. Network Isolation & IP Allowlisting (Recommended)
- **Mechanism:** Configure reverse proxy (Nginx, Cloudflare, AWS ALB) or Express middleware to restrict `/debug/*` and `/api/v1/debug/*` routes exclusively to internal management subnets, trusted VPN IP ranges, or localhost.
- **Benefit:** Prevents external traffic from reaching debug handlers even if both the feature flag is toggled on and admin keys are leaked.

#### 2. Segregated Administrative Keypairs & Role-Based Access Control
- **Mechanism:** Maintain distinct public keys for diagnostic operations (`DEBUG_ADMIN_PUBLIC_KEYS`) separate from primary transaction-signing or configuration admin keys (`ADMIN_PUBLIC_KEYS`).
- **Benefit:** Enforces the principle of least privilege, preventing a compromised diagnostic tool from executing high-privilege smart contract transactions or administrative config updates.

#### 3. Granular Per-Route Rate Limiting
- **Mechanism:** Apply strict rate limiting (e.g., maximum 5 requests/minute) specifically to `/debug/force-fresh-prices` and `/debug/coingecko-test` using `express-rate-limit` with Redis store.
- **Benefit:** Mitigates risk of cache stampedes and protects third-party API quotas against accidental administrative script loops.

#### 4. Automatic Deep Secret Redaction
- **Mechanism:** All responses returned by debug routes must pass through `redactObject()` in `backend/src/utils/secretRedactor.ts`.
- **Coverage:** Redaction regexes and sensitive key tokens cover Stellar secret seeds (`S...`), CoinGecko API keys, Bearer tokens, query parameters (`api_key=...`), email addresses, webhook URLs, and SMTP passwords.

---

### Remediation Status Matrix

| Component / Finding | Severity | Status | Remediation Details |
|---|---|---|---|
| Feature-Flag Perimeter Gate | High | **Remediated** | `blockDebugInProduction` middleware applied to all 6 debug routes; defaults to `404 Not Found` when `ENABLE_DEBUG_ROUTES=false`. |
| Admin Authentication Enforcement | High | **Remediated** | `requireAdmin` Stellar signature verification attached to all 6 debug endpoints (`POST /debug/notifications/test` and all 5 `GET` routes). |
| CoinGecko Test URL / Key Leakage | Medium | **Remediated** | Removed `testUrl` and `apiKeySet` disclosure from `/debug/coingecko-test` response body; API keys passed via secure headers only. |
| Reflector Test API Key Length Leakage | Medium | **Remediated** | Removed `apiKeyLength` from `/debug/reflector-test` response to avoid aiding key bisection attacks. |
| Diagnostic Notification Contact Leakage | Medium | **Remediated** | Integrated `redactObject` with `email` and `webhook` token matching to mask destination endpoints in `/debug/notifications/test`. |
| Cache Thrashing / DoS Vector | High | **Mitigated** | Protected by dual layers of feature flag gating + admin cryptographic signature auth; recommended for IP allowlisting in production deployments. |
| IP Allowlisting / Network Boundary | Medium | **Documented** | Recommended as deployment-level hardening for reverse proxy / API gateway layer. |
| Dedicated Debug Auth Scope | Low | **Documented** | Recommended for multi-tenant / enterprise role separation. |

---

### References

- Issue: [#1314 — [SECURITY] Security review: debug.routes.ts exposure risk in production](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1314)
- Affected code: [`backend/src/api/debug.routes.ts`](../backend/src/api/debug.routes.ts)
- Gating middleware: [`backend/src/middleware/debugGate.ts`](../backend/src/middleware/debugGate.ts)
- Auth middleware: [`backend/src/middleware/auth.ts`](../backend/src/middleware/auth.ts)
- Feature flag config: [`backend/src/config/featureFlags.ts`](../backend/src/config/featureFlags.ts)
- Secret redactor utility: [`backend/src/utils/secretRedactor.ts`](../backend/src/utils/secretRedactor.ts)
- Test suite: [`backend/src/test/debug.routes.test.ts`](../backend/src/test/debug.routes.test.ts)

---

*Last updated: 2026-08-31*
*Audited by: Emmycivity (Security review, issue #1314)*

