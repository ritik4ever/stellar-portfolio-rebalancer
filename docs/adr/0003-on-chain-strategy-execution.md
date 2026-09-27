# ADR 0003: On-Chain Strategy Execution Architecture

## Status

Accepted

## Context

The rebalancer supports threshold, periodic, volatility, and custom rules for deciding when a portfolio may be rebalanced. The system must define which component is authoritative for that decision:

- A backend-only strategy can calculate a signal and ask the contract to execute it.
- An on-chain strategy can evaluate its own rules and enforce the resulting trade constraints in the same environment that holds the portfolio state.

The decision has to balance Soroban gas and resource budgets, the trust users place in the relayer, and the ability to evolve strategy rules without putting existing portfolios at risk. It also needs to preserve liveness: a periodic rule can become eligible on-chain, but a transaction still has to be submitted by a relayer or another caller.

## Decision

Strategy eligibility and execution will be enforced on-chain. The selected strategy and its configuration are stored with each portfolio. Contract code reads validated prices and ledger state, evaluates the strategy (including interval, volatility, or custom-rule constraints), builds the rebalance preview, and enforces the preview and slippage checks before applying trades.

The backend remains responsible for scheduling checks, submitting transactions, and providing analytics and user experience. It is not authoritative for the strategy outcome: a relayer cannot bypass the contract's rules by submitting a different signal or set of trades.

## Implementation Context

The following paths are the intended module boundaries for the strategy implementations; shared types and preview/trade mechanics remain in the existing contract modules:

- `contracts/src/strategies/periodic.rs` for fixed-interval eligibility.
- `contracts/src/strategies/volatility.rs` for price-movement triggers.
- `contracts/src/strategies/custom.rs` for configurable minimum intervals and rule combinations.

The shared on-chain context is `contracts/src/types.rs` (the `StrategyType` and `StrategyConfig` values) and `contracts/src/portfolio.rs` (price validation, previews, and trade calculation).

## Alternatives Considered

| Option | Gas and resources | Trust model | Upgrade flexibility | Decision |
| :--- | :--- | :--- | :--- | :--- |
| Backend-only execution | Lower contract CPU and storage use; still pays for the final transaction. | Users must trust the backend to calculate an honest signal and trade set. | High; backend code can be replaced without a contract upgrade. | Rejected because the backend would be an authority over user funds. |
| Backend signal with on-chain verification | Moderate cost and implementation complexity; duplicates rules across two layers. | Better than backend-only, but verification can leave strategy-specific gaps. | Moderate; contract verification rules still require upgrades. | Rejected as the default because duplicated logic is difficult to keep equivalent. |
| On-chain strategy enforcement (chosen) | Higher CPU, storage, oracle-read, and transaction costs. | Rules and constraints are auditable and enforced by the contract; the relayer is not trusted with the decision. | Lower; changes require a reviewed contract upgrade or a new version with migration. | Chosen for deterministic, verifiable execution. |

## Consequences

### Positive

- **Verifiable trust boundary:** Users and independent callers can inspect the strategy rules and verify that a submitted rebalance satisfies them.
- **Consistent enforcement:** Periodic, volatility, and custom constraints are checked against the same on-chain portfolio, timestamp, and validated-price state used to execute the trade.
- **Safer relaying:** The backend can be replaced or fail without granting it authority to override strategy rules; another relayer can submit an eligible transaction.

### Negative

- **Gas and resource cost:** Strategy evaluation, oracle reads, preview generation, and storage consume Soroban resources and increase transaction fees compared with calculating the signal off-chain.
- **Upgrade friction:** A strategy change requires a reviewed contract upgrade or a new version and migration. Existing portfolios must retain compatible defaults and configuration semantics.
- **Liveness dependency:** On-chain eligibility does not submit a transaction by itself. Relayers, fees, and available oracle data remain operational dependencies, and stale or missing prices can defer a rebalance.

### Operational guardrails

- Keep strategy configuration data-driven and bounded so invalid intervals, thresholds, and trade sizes are rejected before execution.
- Emit strategy and rebalance events so relayers and indexers can reconcile eligibility with execution.
- Use the contract's existing stale-price, slippage, emergency-stop, and upgrade controls when adding or changing strategy implementations.
