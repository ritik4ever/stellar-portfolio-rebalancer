# Contract Gas Baselines

The benchmark tests in `contracts/src/test.rs` use Soroban's `env.budget()` test utilities.

Current baseline (native test runtime):

- `initialize`: CPU `1,500,000`, memory `200,000`
- `create_portfolio`: CPU `2,500,000`, memory `300,000`
- `execute_rebalance`: CPU `5,000,000`, memory `500,000`
- `deposit`: CPU `2,000,000`, memory `250,000`

The benchmark assertions fail if any metric exceeds 120% of the baseline.
