# Pull Request: WASM Hash Publication & API Breaking Change Enforcement

## 📌 References
* **Issues Addressed:** #550, #551
* **Status:** Ready for Review & Merge

---

## 📖 Summary

This pull request implements two DevOps/CI improvements for the Stellar Portfolio Rebalancer:

1. **Issue #550 — Automatic WASM Hash Publication:** The contract build pipeline now automatically computes and publishes the SHA-256 hash of the compiled WASM binary on every CI run. This ensures reproducible builds and simplifies deployment audits.

2. **Issue #551 — API Breaking Change Enforcement:** A new CI guard enforces that any modification to the OpenAPI specification (`spec.ts` or `openapi.json`) is accompanied by documentation updates in `API.md` and/or `CHANGELOG.md`. A new Pull Request template with an API Changes checklist further guides contributors.

Additionally, a pre-existing test compilation issue (`std::println!` in a `#![no_std]` crate) was fixed to ensure the full test suite passes.

---

## 🎯 Key Accomplishments

- [x] **WASM Hash Target:** Added a cross-platform `hash` target to `contracts/Makefile` that auto-runs after `build` and `build-optimized`.
- [x] **CI Integration:** Extended `.github/workflows/build.yml` with Rust toolchain setup, contract build, hash computation (written to `$GITHUB_STEP_SUMMARY`), and WASM artifact upload.
- [x] **README Documentation:** Documented the `make hash` workflow in `README.md` under a new "WASM Hash Verification" section.
- [x] **PR Template:** Created `.github/pull_request_template.md` with an API Changes & Breaking Changes Checklist.
- [x] **Automated API Guard:** Added Part C to `scripts/check-generated-artifacts.sh` to enforce API change notes when route/schema files are modified.
- [x] **CHANGELOG Policy:** Updated `CHANGELOG.md` guidelines to require API change documentation in every PR that modifies the specification.
- [x] **Test Fix:** Added `extern crate std;` to `contracts/src/test.rs` to resolve `std::println!` compilation error in `#![no_std]` environment.

---

## 🛠️ Detailed Changes

### Component 1: WASM Hash Publication (#550)

#### [`contracts/Makefile`](contracts/Makefile)
- Added `.PHONY: hash` target.
- The `hash` target computes SHA-256 of both `portfolio_rebalancer.wasm` and `portfolio_rebalancer.optimized.wasm` using whichever tool is available (`sha256sum`, `shasum`, or `openssl`).
- Both `build` and `build-optimized` targets now automatically invoke `hash` on completion.

#### [`.github/workflows/build.yml`](.github/workflows/build.yml)
- **Setup Rust:** Added `dtolnay/rust-toolchain@stable` with `wasm32-unknown-unknown` target.
- **Cargo Cache:** Added `actions/cache@v4` for `~/.cargo` and `contracts/target` keyed on `Cargo.lock`.
- **Build & Hash:** Runs `make -C contracts build`, computes SHA-256, and writes the hash to `$GITHUB_STEP_SUMMARY` for inline audit visibility.
- **Artifact Upload:** Uploads the compiled WASM via `actions/upload-artifact@v4` as `portfolio-rebalancer-wasm`.

#### [`README.md`](README.md)
- Added "WASM Hash Verification" section with instructions to run `make hash` locally.

---

### Component 2: API Breaking Change Enforcement (#551)

#### [`.github/pull_request_template.md`](.github/pull_request_template.md) — **NEW**
- Standard PR template with Type of Change checkboxes.
- Dedicated **API Changes & Breaking Changes Checklist** section covering OpenAPI spec, API docs, changelog, and migration notes.

#### [`scripts/check-generated-artifacts.sh`](scripts/check-generated-artifacts.sh)
- Added **Part C** logic: when `needs_openapi_check` is true (i.e., `spec.ts` or `openapi.json` changed), the script verifies that `API.md` or `CHANGELOG.md` is also present in the changed files. Fails with a clear remediation message if not.

#### [`CHANGELOG.md`](CHANGELOG.md)
- Added guideline: *"Any modification to the API specification (`spec.ts` or `openapi.json`) requires matching updates to either `API.md` or `CHANGELOG.md` within the same Pull Request (enforced in CI)."*

---

### Bug Fix: Test Compilation

#### [`contracts/src/test.rs`](contracts/src/test.rs)
- Added `extern crate std;` at the top of the test module. The contract crate is `#![no_std]`, but the `assert_cost_within_tolerance` helper uses `std::println!` which requires an explicit `extern crate std` declaration in the test module.

---

## 🧪 Verification

### Contract Build
```
cargo build --target wasm32-unknown-unknown --release
# ✅ Finished `release` profile [optimized] target(s)
```

### Contract Tests
```
cargo test
# ✅ 47 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

All 47 tests pass including:
- Portfolio CRUD operations
- Rebalance trade calculations (2-asset, 5-asset, direction, precision)
- Emergency stop admin/non-admin flows
- Allocation validation (randomized, boundary, overflow)
- Gas benchmarks (initialize, create_portfolio, deposit, execute_rebalance)

### CI Script (Linux/macOS)
```bash
bash scripts/check-generated-artifacts.sh
# Verifies runtime artifact blocklist, OpenAPI freshness, and API change notes
```

---

## 📁 Files Changed

| File | Change Type | Issue |
|------|------------|-------|
| `contracts/Makefile` | Modified | #550 |
| `.github/workflows/build.yml` | Modified | #550 |
| `README.md` | Modified | #550 |
| `.github/pull_request_template.md` | **New** | #551 |
| `scripts/check-generated-artifacts.sh` | Modified | #551 |
| `CHANGELOG.md` | Modified | #551 |
| `contracts/src/test.rs` | Modified | Bug fix |

---

## 🚀 Deployment Notes

These changes are purely DevOps/CI and documentation. No smart contract logic was modified. The contract WASM binary is identical before and after this PR — only the build pipeline and contributor guardrails are enhanced.
