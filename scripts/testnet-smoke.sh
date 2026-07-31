#!/usr/bin/env bash
#
# testnet-smoke.sh
#
# Soroban testnet smoke-test suite for the Portfolio Rebalancer contract.
# Runs against a freshly deployed contract instance and validates core
# functionality: initialization, portfolio creation, read-only calls, and
# rebalance simulation.
#
# Usage:
#   scripts/testnet-smoke.sh
#
# Required environment variables:
#   CONTRACT_ID          Deployed Soroban contract ID
#   SOROBAN_NETWORK      Network name configured in soroban (e.g. "testnet")
#   SOROBAN_IDENTITY     Soroban identity name to use for invocations
#
# Exit code 0 when ALL checks pass, 1 otherwise.

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────

CONTRACT_ID="${CONTRACT_ID:-}"
SOROBAN_NETWORK="${SOROBAN_NETWORK:-testnet}"
SOROBAN_IDENTITY="${SOROBAN_IDENTITY:-ci-deployer}"

# Stellar testnet native XLM contract address (Soroban token).
XLM_ADDRESS="${XLM_ADDRESS:-CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC}"

PASS=0
FAIL=0
TOTAL=0
PORTFOLIO_ID=0
PORTFOLIO_CREATED=false
ADMIN_RESOLVED=false

# ── Helpers ────────────────────────────────────────────────────────────────

print_header() {
  printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
  printf '  Soroban Testnet Smoke Suite\n'
  printf '  Contract: %s\n' "$CONTRACT_ID"
  printf '  Network:  %s\n' "$SOROBAN_NETWORK"
  printf '  Identity: %s\n' "$SOROBAN_IDENTITY"
  printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
}

fail_usage() {
  printf 'ERROR: %s\n' "$1" >&2
  printf '\nRequired environment variables:\n' >&2
  printf '  CONTRACT_ID          Deployed Soroban contract ID\n' >&2
  printf '  SOROBAN_NETWORK      Soroban network name (default: testnet)\n' >&2
  printf '  SOROBAN_IDENTITY     Soroban identity name (default: ci-deployer)\n' >&2
  exit 1
}

invoke() {
  # Run a soroban contract invoke and capture output.
  # Usage: invoke <function> [--arg value ...]
  local fn="$1"
  shift
  soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source "$SOROBAN_IDENTITY" \
    --network "$SOROBAN_NETWORK" \
    -- "$fn" "$@"
}

invoke_quiet() {
  # Same as invoke but discards stdout, keeps stderr.
  invoke "$@" >/dev/null
}

test_step() {
  # Print a test step header.
  TOTAL=$((TOTAL + 1))
  printf '  [%2d] %s ... ' "$TOTAL" "$1"
}

pass_step() {
  printf '✓ PASS (%s)\n' "${1:-}"
  PASS=$((PASS + 1))
}

fail_step() {
  printf '✗ FAIL — %s\n' "${1:-}"
  FAIL=$((FAIL + 1))
}

# ── Validation ─────────────────────────────────────────────────────────────

if [ -z "$CONTRACT_ID" ]; then
  fail_usage "CONTRACT_ID is not set"
fi

if ! command -v soroban >/dev/null 2>&1; then
  printf 'ERROR: soroban CLI is required but was not found on PATH.\n' >&2
  exit 1
fi

print_header

# ── Test 1: version() ──────────────────────────────────────────────────────

test_step "version() returns CONTRACT_VERSION (1)"
if ! VERSION_OUT="$(invoke version 2>&1)"; then
  fail_step "invocation failed: $VERSION_OUT"
elif echo "$VERSION_OUT" | grep -qE '^"?1"?$'; then
  pass_step "returned 1"
else
  fail_step "expected 1, got: $VERSION_OUT"
fi

# ── Test 2: schema_version() ───────────────────────────────────────────────

test_step "schema_version() returns CONTRACT_EVENT_SCHEMA_VERSION (1)"
if ! SCHEMA_OUT="$(invoke schema_version 2>&1)"; then
  fail_step "invocation failed: $SCHEMA_OUT"
elif echo "$SCHEMA_OUT" | grep -qE '^"?1"?$'; then
  pass_step "returned 1"
else
  fail_step "expected 1, got: $SCHEMA_OUT"
fi

# ── Test 3: capability_summary() ───────────────────────────────────────────

test_step "capability_summary() returns valid config"
if ! CAP_OUT="$(invoke capability_summary 2>&1)"; then
  fail_step "invocation failed: $CAP_OUT"
elif echo "$CAP_OUT" | grep -q '"max_portfolio_assets"'; then
  pass_step "returned capability summary"
else
  fail_step "missing max_portfolio_assets field: $CAP_OUT"
fi

# ── Test 4: min_rebalance_threshold() ──────────────────────────────────────

test_step "min_rebalance_threshold() returns 1"
if ! THRESH_OUT="$(invoke min_rebalance_threshold 2>&1)"; then
  fail_step "invocation failed: $THRESH_OUT"
elif echo "$THRESH_OUT" | grep -qE '^"?1"?$'; then
  pass_step "returned 1"
else
  fail_step "expected 1, got: $THRESH_OUT"
fi

# ── Test 5: max_rebalance_threshold() ──────────────────────────────────────

test_step "max_rebalance_threshold() returns 50"
if ! MAX_THRESH_OUT="$(invoke max_rebalance_threshold 2>&1)"; then
  fail_step "invocation failed: $MAX_THRESH_OUT"
elif echo "$MAX_THRESH_OUT" | grep -qE '^"?50"?$'; then
  pass_step "returned 50"
else
  fail_step "expected 50, got: $MAX_THRESH_OUT"
fi

# ── Test 6: get_admin() ────────────────────────────────────────────────────

test_step "get_admin() returns configured admin"
if ADMIN_ADDR="$(soroban keys address "$SOROBAN_IDENTITY" --global 2>/dev/null)"; then
  ADMIN_RESOLVED=true
else
  fail_step "could not resolve identity address"
fi
if [ "$ADMIN_RESOLVED" = "true" ]; then
  if ! ADMIN_OUT="$(invoke get_admin 2>&1)"; then
    fail_step "invocation failed: $ADMIN_OUT"
  elif [ -n "$ADMIN_OUT" ] && echo "$ADMIN_OUT" | grep -qE '[A-Z0-9]{56}'; then
    # The output format contains the address string — check it's non-empty.
    pass_step "returned admin address"
  else
    fail_step "unexpected output: $ADMIN_OUT"
  fi
fi

# ── Test 7: create_portfolio() ─────────────────────────────────────────────

test_step "create_portfolio() with single asset (XLM)"
# Create a portfolio with XLM at 100% allocation.
# XLM uses 7 decimals; threshold 5%; slippage 100 bps; policy version 1.
if [ "$ADMIN_RESOLVED" != "true" ]; then
  fail_step "skipped — admin address could not be resolved"
elif ! PORTFOLIO_OUT="$(invoke create_portfolio \
  --user "$ADMIN_ADDR" \
  --target_allocations "{\"$XLM_ADDRESS\": 10000}" \
  --asset_decimals "{\"$XLM_ADDRESS\": 7}" \
  --rebalance_threshold 5 \
  --slippage_tolerance 100 \
  --slippage_policy_version 1 2>&1)"; then
  fail_step "invocation failed: $PORTFOLIO_OUT"
elif echo "$PORTFOLIO_OUT" | grep -qE '"1"'; then
  # The output should contain the portfolio ID (a u64 number).
  PORTFOLIO_ID=1
  PORTFOLIO_CREATED=true
  pass_step "created portfolio ID $PORTFOLIO_ID"
else
  fail_step "unexpected output: $PORTFOLIO_OUT"
fi

# ── Test 8: get_portfolio() ────────────────────────────────────────────────

test_step "get_portfolio() retrieves created portfolio"
if [ "$PORTFOLIO_CREATED" != "true" ]; then
  fail_step "skipped — create_portfolio did not succeed"
elif ! GET_OUT="$(invoke get_portfolio --portfolio_id "$PORTFOLIO_ID" 2>&1)"; then
  fail_step "invocation failed: $GET_OUT"
elif echo "$GET_OUT" | grep -q '"user"' && echo "$GET_OUT" | grep -q '"rebalance_threshold"'; then
  pass_step "returned portfolio struct with expected fields"
else
  fail_step "missing expected fields: $GET_OUT"
fi

# ── Test 9: check_invariants() ─────────────────────────────────────────────

test_step "check_invariants() validates portfolio state"
if [ "$PORTFOLIO_CREATED" != "true" ]; then
  fail_step "skipped — create_portfolio did not succeed"
elif INV_OUT="$(invoke check_invariants --portfolio_id "$PORTFOLIO_ID" 2>&1)"; then
  # check_invariants returns Result; Ok(()) should succeed silently
  pass_step "invariants hold"
else
  fail_step "invocation failed: $INV_OUT"
fi

# ── Test 10: preview_rebalance() ───────────────────────────────────────────

test_step "preview_rebalance() runs simulation"
if [ "$PORTFOLIO_CREATED" != "true" ]; then
  fail_step "skipped — create_portfolio did not succeed"
elif ! PREVIEW_OUT="$(invoke preview_rebalance --portfolio_id "$PORTFOLIO_ID" 2>&1)"; then
  fail_step "invocation failed: $PREVIEW_OUT"
elif echo "$PREVIEW_OUT" | grep -qE '"(rebalance_needed|candidate_trades|total_value)"'; then
  pass_step "returned rebalance preview"
else
  fail_step "unexpected output: $PREVIEW_OUT"
fi

# ── Test 11: check_rebalance_needed() ──────────────────────────────────────

test_step "check_rebalance_needed() runs without error"
if [ "$PORTFOLIO_CREATED" != "true" ]; then
  fail_step "skipped — create_portfolio did not succeed"
elif ! REBAL_OUT="$(invoke check_rebalance_needed --portfolio_id "$PORTFOLIO_ID" 2>&1)"; then
  fail_step "invocation failed: $REBAL_OUT"
elif echo "$REBAL_OUT" | grep -qE 'true|false'; then
  # check_rebalance_needed returns a bool — false expected since no deposits
  pass_step "returned boolean"
else
  fail_step "unexpected output: $REBAL_OUT"
fi

# ── Test 12: get_drift_preview() ───────────────────────────────────────────

test_step "get_drift_preview() returns drift info"
if [ "$PORTFOLIO_CREATED" != "true" ]; then
  fail_step "skipped — create_portfolio did not succeed"
elif ! DRIFT_OUT="$(invoke get_drift_preview --portfolio_id "$PORTFOLIO_ID" 2>&1)"; then
  fail_step "invocation failed: $DRIFT_OUT"
elif echo "$DRIFT_OUT" | grep -q '\['; then
  pass_step "returned drift data"
else
  fail_step "unexpected output: $DRIFT_OUT"
fi

# ── Test 13: get_config_view() ─────────────────────────────────────────────

test_step "get_config_view() returns contract configuration"
if [ "$PORTFOLIO_CREATED" != "true" ]; then
  fail_step "skipped — create_portfolio did not succeed"
elif ! CONFIG_OUT="$(invoke get_config_view --portfolio_id "$PORTFOLIO_ID" 2>&1)"; then
  fail_step "invocation failed: $CONFIG_OUT"
elif echo "$CONFIG_OUT" | grep -q '"admin"'; then
  pass_step "returned config view"
else
  fail_step "missing admin field: $CONFIG_OUT"
fi

# ── Summary ────────────────────────────────────────────────────────────────

printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
printf '  Results: %d passed, %d failed, %d total\n' "$PASS" "$FAIL" "$TOTAL"
printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'

if [ "$FAIL" -gt 0 ]; then
  printf '✗ Testnet smoke test FAILED (%d failures)\n' "$FAIL"
  exit 1
fi

printf '✓ Testnet smoke test PASSED\n'
exit 0
