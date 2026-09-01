# Stellar Portfolio Rebalancer — Soroban Contract

Soroban smart contract for the Stellar Portfolio Rebalancer. It manages
portfolios on-chain (create/deposit/withdraw), computes rebalance trades, and
exposes the strategy-aware lifecycle (`check_rebalance_needed`,
`preview_rebalance`, `execute_rebalance`, `configure_dca`, `execute_dca`, ...).

See [`CONTRACT_ABI.md`](./CONTRACT_ABI.md) for the full contract surface and
[`BENCHMARKS.md`](./BENCHMARKS.md) for benchmark results.

## Toolchain

The contract pins `soroban-sdk = "27.0.2"`. Use the pinned nightly toolchain
that matches this SDK (see `.rust-toolchain.toml` if present, or the soroban
docs). Contract unit tests run with:

```bash
cargo test --features testutils
```

## Fuzzing with `cargo fuzz`

The `fuzz/` sub-crate contains libFuzzer harnesses for the pure portfolio math
(`calculate_rebalance_trades`, allocation validation, and price
conversion helpers). Fuzzing catches panics and overflow/underflow that can't
be reached by the hand-written test vectors.

### Prerequisites

- Rust **nightly** (libFuzzer-style targets require nightly).
- [`cargo-fuzz`](https://rust-fuzz.github.io/book/cargo-fuzz.html):

```bash
rustup toolchain install nightly
rustup component add llvm-tools-preview --toolchain nightly
cargo install cargo-fuzz
```

### Running a target

Run any target from the repository root (or from `contracts/`):

```bash
cargo +nightly fuzz run fuzz_rebalance_trades
```

Other targets:

```bash
cargo +nightly fuzz run fuzz_rebalance       # trades from fixed-layout byte chunks
cargo +nightly fuzz run fuzz_allocations     # validate_allocations / boundary constants
cargo +nightly fuzz run fuzz_oracle_prices   # balance_to_value / value_to_balance, incl. price == 0
```

Useful flags:

```bash
# Run for a fixed duration (seconds)
cargo +nightly fuzz run fuzz_rebalance_trades -- -max_total_time=300

# Minimise a reproducer found in the corpus or by a crash
cargo +nightly fuzz tmin fuzz_rebalance_trades /path/to/crash-artifact

# Reduce the corpus
cargo +nightly fuzz cmin fuzz_rebalance_trades
```

### Target guide

| Target | Input model | Invariant asserted |
| --- | --- | --- |
| `fuzz_rebalance_trades` | `#[derive(Arbitrary)]` struct: asset count, allocation bps, balance seeds, price seeds, decimals, extreme-total-value flag. Allocations are normalised to sum to `ALLOCATION_DENOMINATOR` with no zero-weight assets. | `calculate_rebalance_trades` never panics; every trade is above `MIN_TRADE_AMOUNT_STROOPS` and stays away from the `i128` boundaries; normalised allocations pass `validate_allocations`. |
| `fuzz_rebalance` | Fixed 3-byte-per-asset layout (`[pct, balance, price]`). | Same postconditions on `calculate_rebalance_trades` trades. |
| `fuzz_allocations` | Arbitrary percentage maps plus single-asset cases. | `validate_allocations` returns `Ok`-equivalent booleans without panicking; MIN/MAX constants stay ordered. |
| `fuzz_oracle_prices` | Raw 16-byte `(price, balance)` pairs plus hand-picked extremes. | `balance_to_value` / `value_to_balance` never panic, including `price == 0`. |

### Corpus & CI

- Seed corpora (when added) live under `fuzz/corpus/<target>/`.
- A reasonable smoke gate is a few minutes per target:

```bash
cargo +nightly fuzz run fuzz_rebalance_trades -- -max_total_time=120
```