#!/usr/bin/env bash
# scripts/loki-retention-check.sh
#
# Validate that the Loki compactor is running and retention is healthy.
# Intended to be run:
#   • manually by operators during on-call investigations
#   • from CI via the validate-loki-config job in .github/workflows/observability-lint.yml
#
# Usage:
#   ./scripts/loki-retention-check.sh [LOKI_URL]
#
# Default LOKI_URL: http://localhost:3100
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed (details printed to stderr)
#
# Dependencies: curl, jq (both typically available in CI runners)

set -euo pipefail

LOKI_URL="${1:-http://localhost:3100}"
FAILURES=0

# ── helpers ────────────────────────────────────────────────────────────────

ok()   { echo "  ✅  $*"; }
warn() { echo "  ⚠️   $*" >&2; FAILURES=$((FAILURES + 1)); }
info() { echo "  ℹ️   $*"; }
hr()   { echo "────────────────────────────────────────────────────────────────"; }

# ── prerequisite checks ────────────────────────────────────────────────────

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is required" >&2; exit 1
fi
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required" >&2; exit 1
fi

hr
echo "🔍  Loki Retention & Compaction Health Check"
echo "    Target: ${LOKI_URL}"
hr

# ── 1. Loki readiness ──────────────────────────────────────────────────────

echo ""
echo "1. Loki readiness"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${LOKI_URL}/ready" || true)
if [[ "${HTTP_STATUS}" == "200" ]]; then
  ok "Loki is ready (HTTP ${HTTP_STATUS})"
else
  warn "Loki is NOT ready (HTTP ${HTTP_STATUS}).  Is the container running?"
fi

# ── 2. Config snapshot – retention_enabled ─────────────────────────────────

echo ""
echo "2. Retention configuration"
CONFIG_RAW=$(curl -s "${LOKI_URL}/config" || true)

if echo "${CONFIG_RAW}" | jq -e '.compactor.retention_enabled == true' &>/dev/null; then
  ok "compactor.retention_enabled = true"
else
  warn "compactor.retention_enabled is NOT true – log deletion will never fire."
fi

RETENTION_PERIOD=$(echo "${CONFIG_RAW}" | jq -r '.limits_config.retention_period // "not set"')
info "limits_config.retention_period = ${RETENTION_PERIOD}"

COMPACTION_INTERVAL=$(echo "${CONFIG_RAW}" | jq -r '.compactor.compaction_interval // "not set"')
info "compactor.compaction_interval  = ${COMPACTION_INTERVAL}"

# ── 3. Compactor metrics – last successful run ─────────────────────────────

echo ""
echo "3. Compactor last-run timestamp"
METRICS_RAW=$(curl -s "${LOKI_URL}/metrics" || true)

LAST_RUN=$(echo "${METRICS_RAW}" \
  | grep 'loki_boltdb_shipper_compact_tables_operation_last_successful_run_timestamp_seconds' \
  | awk '{print $2}' || true)

NOW=$(date +%s)

if [[ -z "${LAST_RUN}" || "${LAST_RUN}" == "0" ]]; then
  warn "Compactor has never completed a cycle (metric = 0 or absent)."
else
  AGE=$(( NOW - ${LAST_RUN%.*} ))   # strip fractional seconds
  if (( AGE > 1800 )); then
    warn "Compactor last ran ${AGE}s ago (> 30 min threshold). Retention may be stalled."
  else
    ok "Compactor last ran ${AGE}s ago – within the 30-minute threshold."
  fi
fi

# ── 4. Per-stream retention rules present ──────────────────────────────────

echo ""
echo "4. Per-stream retention overrides"
STREAM_RULES=$(echo "${CONFIG_RAW}" | jq '.per_stream_retention | length' 2>/dev/null || echo "0")
if [[ "${STREAM_RULES}" -ge 1 ]]; then
  ok "${STREAM_RULES} per-stream retention rule(s) configured."
  echo "${CONFIG_RAW}" | jq -r '.per_stream_retention[] | "     \(.selector)  →  \(.period)"' 2>/dev/null || true
else
  warn "No per-stream retention rules found – only the global default applies."
fi

# ── 5. Loki label volume API – top labels ─────────────────────────────────

echo ""
echo "5. Loki label sanity (top labels visible)"
LABELS_RAW=$(curl -s "${LOKI_URL}/loki/api/v1/labels" || true)
LABEL_COUNT=$(echo "${LABELS_RAW}" | jq '.data | length' 2>/dev/null || echo "0")
if (( LABEL_COUNT > 0 )); then
  ok "${LABEL_COUNT} label(s) visible in Loki."
  echo "${LABELS_RAW}" | jq -r '.data[]' 2>/dev/null | head -10 | sed 's/^/     /'
else
  info "No labels returned – Loki may be empty (expected on a fresh install)."
fi

# ── summary ───────────────────────────────────────────────────────────────

hr
if (( FAILURES == 0 )); then
  echo "✅  All retention health checks passed."
  exit 0
else
  echo "❌  ${FAILURES} check(s) failed – see warnings above." >&2
  exit 1
fi
