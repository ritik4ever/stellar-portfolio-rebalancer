#!/usr/bin/env bash
#
# health-smoke.sh
#
# Portable health smoke test. Probes the backend's key operational surfaces and
# prints an easy-to-read pass/fail summary. Use it after a deploy or during
# triage against local, staging, or production.
#
# Usage:
#   scripts/health-smoke.sh [target]
#
#   target   One of: local | staging | prod, or a full base URL
#            (e.g. https://api.example.com). Defaults to "local".
#
# Environment overrides (base URLs per target):
#   SMOKE_LOCAL_URL     default: http://localhost:3001
#   SMOKE_STAGING_URL   (required when target=staging and no URL is given)
#   SMOKE_PROD_URL      (required when target=prod and no URL is given)
#   SMOKE_TIMEOUT       per-request timeout in seconds (default: 10)
#
# Examples:
#   scripts/health-smoke.sh                      # probe local
#   scripts/health-smoke.sh staging              # probe SMOKE_STAGING_URL
#   scripts/health-smoke.sh https://api.host     # probe an explicit URL
#
# Exit code 0 when all REQUIRED checks pass, 1 otherwise. Non-required checks
# (readiness, metrics) report a warning instead of failing the run, because they
# can be legitimately degraded (e.g. readiness is 503 until Redis/workers are up).

set -uo pipefail

TARGET="${1:-local}"
TIMEOUT="${SMOKE_TIMEOUT:-10}"

# Resolve the base URL from the target argument.
case "${TARGET}" in
  local)
    BASE_URL="${SMOKE_LOCAL_URL:-http://localhost:3001}"
    ;;
  staging)
    BASE_URL="${SMOKE_STAGING_URL:-}"
    if [[ -z "${BASE_URL}" ]]; then
      echo "✗ target 'staging' selected but SMOKE_STAGING_URL is not set." >&2
      exit 1
    fi
    ;;
  prod|production)
    BASE_URL="${SMOKE_PROD_URL:-}"
    if [[ -z "${BASE_URL}" ]]; then
      echo "✗ target 'prod' selected but SMOKE_PROD_URL is not set." >&2
      exit 1
    fi
    ;;
  http://*|https://*)
    BASE_URL="${TARGET}"
    ;;
  *)
    echo "✗ unknown target '${TARGET}'. Use: local | staging | prod | <base URL>" >&2
    exit 1
    ;;
esac

# Strip any trailing slash so path concatenation is clean.
BASE_URL="${BASE_URL%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "✗ curl is required but was not found on PATH." >&2
  exit 1
fi

# Checks are defined as parallel arrays (bash 3.2 compatible — no associative
# arrays). Keep the indexes aligned across all five arrays.
#   NAME      human-readable label
#   PATH      request path appended to BASE_URL
#   EXPECT    expected HTTP status code
#   REQUIRED  "true" → a failure fails the whole run; "false" → warning only
#   MATCH     optional substring that must appear in the response body
CHECK_NAMES=(  "liveness"     "api-health"   "readiness" "metrics"  )
CHECK_PATHS=(  "/health"      "/api/health"  "/ready"    "/metrics" )
CHECK_EXPECT=( "200"          "200"          "200"       "200"      )
CHECK_REQUIRED=( "true"       "true"         "false"     "false"    )
CHECK_MATCH=(  "ok"           "status"       ""          ""         )

echo "Health smoke test → ${BASE_URL}  (target: ${TARGET}, timeout: ${TIMEOUT}s)"
echo "-------------------------------------------------------------------------"

pass_count=0
fail_count=0
warn_count=0
body_file="$(mktemp 2>/dev/null || echo /tmp/health-smoke-body.$$)"
trap 'rm -f "${body_file}"' EXIT

i=0
while [[ ${i} -lt ${#CHECK_NAMES[@]} ]]; do
  name="${CHECK_NAMES[$i]}"
  path="${CHECK_PATHS[$i]}"
  expect="${CHECK_EXPECT[$i]}"
  required="${CHECK_REQUIRED[$i]}"
  match="${CHECK_MATCH[$i]}"
  url="${BASE_URL}${path}"

  # Capture status code and total time; body goes to a temp file for matching.
  metrics="$(curl -sS -o "${body_file}" -w '%{http_code} %{time_total}' \
    --max-time "${TIMEOUT}" "${url}" 2>/dev/null)"
  curl_rc=$?

  if [[ ${curl_rc} -ne 0 ]]; then
    status="000"
    elapsed="-"
  else
    status="${metrics%% *}"
    elapsed="${metrics##* }s"
  fi

  reason=""
  ok=true
  if [[ "${status}" != "${expect}" ]]; then
    ok=false
    reason="expected HTTP ${expect}, got ${status}"
  elif [[ -n "${match}" ]] && ! grep -qi -- "${match}" "${body_file}" 2>/dev/null; then
    ok=false
    reason="body did not contain '${match}'"
  fi

  if [[ "${ok}" == "true" ]]; then
    printf '  \xE2\x9C\x93 %-11s %-13s %s (%s)\n' "${name}" "${path}" "${status}" "${elapsed}"
    pass_count=$((pass_count + 1))
  elif [[ "${required}" == "true" ]]; then
    printf '  \xE2\x9C\x97 %-11s %-13s FAIL — %s\n' "${name}" "${path}" "${reason}"
    fail_count=$((fail_count + 1))
  else
    printf '  \xE2\x9A\xA0 %-11s %-13s WARN — %s\n' "${name}" "${path}" "${reason}"
    warn_count=$((warn_count + 1))
  fi

  i=$((i + 1))
done

echo "-------------------------------------------------------------------------"
echo "Summary: ${pass_count} passed, ${fail_count} failed, ${warn_count} warning(s)"

if [[ ${fail_count} -ne 0 ]]; then
  echo "✗ Health smoke test FAILED for ${BASE_URL}"
  exit 1
fi

echo "✓ Health smoke test passed for ${BASE_URL}"
exit 0
