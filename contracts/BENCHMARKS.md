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

### Machine-Readable JSON Output

To emit results in JSON format (suitable for CI diffing and automated comparison):

```bash
make bench-json
```

This produces `contracts/bench_results.json` with the following schema:

```json
[
  {
    "benchmark": "initialize",
    "cpu": 1500000,
    "baseline_cpu": 1500000,
    "mem": 200000,
    "baseline_mem": 200000
  }
]
```

CI artifact `bench-results-json` is uploaded on pull requests so that tooling can diff benchmark regressions across commits. See `.github/workflows/contract-smoke.yml` for the pipeline integration.

---

## NAV Snapshot Gas Costs (Issue #954)

The `snapshot_nav` and `get_nav_history` functions introduced in `contracts/src/nav.rs` were benchmarked across two scenarios:

| Scenario | Description |
|---|---|
| **Empty history** | First ever snapshot for a portfolio (no existing history vector in storage) |
| **Full history (eviction)** | 100 existing snapshots; 101st snapshot triggers ring-buffer eviction of the oldest entry |

### Estimated Instruction Costs

> The figures below are conservative estimates based on Soroban's instruction cost model for persistent storage reads/writes and Vec operations. Exact runtime numbers can be observed by running the benchmark test with `--nocapture`:
>
> ```bash
> cd contracts
> cargo test test_benchmark_nav_operations -- --nocapture
> ```

| Function | Scenario | Estimated CPU Instructions | Estimated Memory Bytes | Notes |
|---|---|---:|---:|---|
| `snapshot_nav` | Empty history | ~3,500,000 | ~180,000 | Includes oracle price read, NAV calculation, Vec init, persistent write, event emit |
| `snapshot_nav` | Full history (eviction) | ~5,200,000 | ~420,000 | Includes Vec deserialization (100 entries), `slice()` eviction, re-serialization, write |
| `get_nav_history` | 100 entries, limit=10 | ~1,800,000 | ~220,000 | Persistent read + Vec slice |
| `get_nav_history` | 100 entries, limit=100 | ~2,100,000 | ~390,000 | Full history read, no slice needed |

### Storage Rent Impact

- History is stored under `DataKey::NavHistory(portfolio_id)` as a `Vec<NavSnapshot>` in **persistent storage**.
- Each `NavSnapshot` occupies ~32 bytes on-chain (`i128` + `u32` + `u64` = 20 bytes + XDR framing).
- A full 100-entry history vector costs approximately **~3.2 KB** in ledger storage per portfolio.
- Ledger rent is charged per byte per ledger; at 100 entries this represents a modest ongoing rent cost per portfolio.
- The ring buffer cap of 100 entries ensures storage growth is **O(1)** after the first 100 rebalances — no unbounded growth.

### Why 100 Entries?

The 100-entry cap was chosen to:
1. Cover at least 100 rebalance cycles (sufficient for weeks or months of analytics data depending on frequency).
2. Keep the full-history read well within the 10,000,000 CPU instruction budget per transaction.
3. Limit per-portfolio storage rent to a predictable ~3.2 KB ceiling.

To change the cap, update `MAX_NAV_SNAPSHOTS` in `contracts/src/nav.rs`.
