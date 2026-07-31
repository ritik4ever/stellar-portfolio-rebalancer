# Security Audit – Stellar Portfolio Rebalancer

## Finding #1520 – Storage-Spam DoS via `create_portfolio`

| Field | Value |
|---|---|
| **ID** | 1520 |
| **Title** | Storage-spam DoS via unbounded `create_portfolio` calls |
| **Severity** | High |
| **Status** | Mitigated (per-user cap + admin-configurable global cap) |
| **Affected component** | `contracts/src/lib.rs` – `create_portfolio` |
| **Related issue** | Per-user cap tracked separately (cross-reference: issue #1520) |

### Description

Prior to this fix, `create_portfolio` had no limit on how many portfolios a
single address—or the contract as a whole—could create. Each successful call
writes a new persistent storage entry (`DataKey::Portfolio(id)`) on the Stellar
ledger. Soroban persistent entries carry a rent fee, but the fee is paid by the
*contract* (or the invoking transaction), not by the attacker. An adversary
controlling many accounts could therefore:

1. Create thousands of portfolios across many addresses, inflating the
   contract's persistent-storage footprint.
2. Force the contract to pay escalating rent fees, eventually exhausting its
   XLM balance and causing it to be evicted from the ledger.
3. Degrade read performance for legitimate users because ledger-entry lookups
   become more expensive as the total entry count grows.

Because `create_portfolio` requires only a valid `user.require_auth()` call and
a well-formed allocation map, the barrier to mounting this attack is low: any
Stellar account can sign a transaction, and the minimum XLM balance required to
keep an account alive is small.

### Storage-Rent / Cost Analysis

Each `Portfolio` entry serialises to roughly 200–3 072 bytes of XDR (bounded by
`MAX_PORTFOLIO_STORAGE_BYTES = 3 072`). Soroban charges rent proportional to
entry size × ledger age. At 10 000 portfolios the contract would carry up to
~30 MB of persistent state, with rent accruing every ledger (~5 s). At 100 000
portfolios the rent burden becomes unsustainable for a community-operated
deployment.

### Chosen Mitigations

Two complementary caps are enforced inside `create_portfolio` before any
storage is written:

#### 1. Per-user cap (`MAX_PORTFOLIOS_PER_USER = 10`)

A `DataKey::UserPortfolioCount(Address)` persistent counter is incremented on
every successful portfolio creation. If the counter already equals
`MAX_PORTFOLIOS_PER_USER` the call returns `Error::PortfolioLimitExceeded`
(error code 29) immediately, before touching any other storage.

- Constant: `MAX_PORTFOLIOS_PER_USER = 10` (`contracts/src/types.rs`)
- Error: `Error::PortfolioLimitExceeded = 29` (`contracts/src/types.rs`)
- Storage key: `DataKey::UserPortfolioCount(Address)` (persistent)

This cap bounds the worst-case storage contribution of any single address to
10 portfolio entries, regardless of how many transactions they submit.

#### 2. Admin-configurable global cap (`DEFAULT_GLOBAL_PORTFOLIO_CAP = 10_000`)

The `NextPortfolioId` counter (which equals the number of portfolios ever
created + 1) is compared against a global cap stored in instance storage under
`DataKey::GlobalPortfolioCap`. If the next ID would exceed the cap the call
returns `Error::GlobalPortfolioCapExceeded` (error code 30).

The cap defaults to `DEFAULT_GLOBAL_PORTFOLIO_CAP = 10_000` and can be raised
or lowered at any time by the contract admin via `set_global_portfolio_cap`.

- Default constant: `DEFAULT_GLOBAL_PORTFOLIO_CAP = 10_000` (`contracts/src/types.rs`)
- Error: `Error::GlobalPortfolioCapExceeded = 30` (`contracts/src/types.rs`)
- Storage key: `DataKey::GlobalPortfolioCap` (instance)
- Admin function: `set_global_portfolio_cap(env, cap: u32)` (`contracts/src/lib.rs`)
- Read function: `get_global_portfolio_cap(env) -> u32` (`contracts/src/lib.rs`)
- User count read: `get_user_portfolio_count(env, user: Address) -> u32` (`contracts/src/lib.rs`)

#### Why not a minimum-balance / fee requirement?

A minimum XLM deposit per portfolio was considered but rejected for the
following reasons:

- It requires a token-transfer sub-invocation, adding CPU budget pressure and
  complexity to an already-validated path.
- It creates UX friction for legitimate users who may want to create several
  portfolios for different strategies.
- The per-user cap already makes the attack economically unattractive: an
  attacker needs a fresh Stellar account (minimum 1 XLM reserve) per 10
  portfolios, raising the cost of a meaningful attack by orders of magnitude.

### Residual Risk

- An attacker with many funded accounts can still create up to
  `global_cap × 1` portfolios total before the global cap fires. The admin
  should lower `GlobalPortfolioCap` if the deployment is expected to serve a
  small user base.
- The per-user counter is stored in persistent storage and is therefore subject
  to the same rent rules as portfolios. If a user's counter entry is evicted
  (ledger TTL expiry) the count resets to 0, allowing that user to create
  another 10 portfolios. Operators should ensure the contract's XLM balance is
  sufficient to keep all persistent entries alive, or use `extend_ttl` calls
  as part of routine maintenance.

### Recommendations for Operators

1. After deployment, call `set_global_portfolio_cap` to set a cap appropriate
   for the expected user base (e.g. 1 000 for a private beta).
2. Monitor `NextPortfolioId` via `get_global_portfolio_cap` and the on-chain
   counter to detect unusual growth.
3. Consider adding an off-chain rate-limit at the backend API layer
   (`POST /api/v1/portfolio`) as a defence-in-depth measure.

### Test Coverage

Unit tests covering this finding are located in `contracts/src/test.rs`:

- `test_create_portfolio_per_user_limit_enforced` – verifies the 11th portfolio
  from the same user returns `Error::PortfolioLimitExceeded`.
- `test_create_portfolio_per_user_limit_different_users` – verifies different
  users are tracked independently.
- `test_create_portfolio_global_cap_enforced` – verifies that once
  `NextPortfolioId` exceeds the configured global cap,
  `Error::GlobalPortfolioCapExceeded` is returned.
- `test_set_global_portfolio_cap_admin_only` – verifies non-admin callers
  cannot change the global cap.
- `test_get_user_portfolio_count` – verifies the counter increments correctly
  and reads back accurately.
- `test_get_global_portfolio_cap_default` – verifies the default cap is
  returned when none has been set.
