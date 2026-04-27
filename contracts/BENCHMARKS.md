# Soroban Contract Benchmarks

## Method

Benchmarks are implemented as test cases in `contracts/src/test.rs` and use Soroban SDK instruction cost utilities:

- `env.budget().cpu_instruction_cost()`
- `env.budget().memory_bytes_cost()`

The test suite tracks gas baselines for:

- `initialize`
- `create_portfolio`
- `execute_rebalance`
- `deposit`

## Baseline Numbers

| Function | Baseline CPU instructions | Baseline memory bytes | Max allowed before failure (+20%) |
| --- | ---: | ---: | ---: |
| `initialize` | 1,500,000 | 200,000 | 1,800,000 CPU / 240,000 mem |
| `create_portfolio` | 2,500,000 | 300,000 | 3,000,000 CPU / 360,000 mem |
| `execute_rebalance` | 5,000,000 | 500,000 | 6,000,000 CPU / 600,000 mem |
| `deposit` | 2,000,000 | 250,000 | 2,400,000 CPU / 300,000 mem |

If any benchmark exceeds its threshold, tests fail and CI will flag the regression.

## Running Benchmarks

From `contracts/`:

```bash
make bench
```
