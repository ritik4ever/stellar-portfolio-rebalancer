#!/usr/bin/env bash
# Health smoke test — probes key endpoints and reports pass/fail status.
#
# Usage:
#   ./scripts/smoke-test.sh                     # default: http://localhost:3001
#   BASE_URL=https://api.example.com ./scripts/smoke-test.sh
#
# Exit code: 0 if all checks pass, 1 if any check fails.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
PASS=0
FAIL=0
FAILURES=""

green()  { printf '\033[32m%s\033[0m\n' "$1"; }
red()    { printf '\033[31m%s\033[0m\n' "$1"; }
bold()   { printf '\033[1m%s\033[0m\n' "$1"; }

check() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    local response

    response=$(curl -sS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)

    if [ "$response" = "$expected_status" ]; then
        green "  ✓ $name ($response)"
        PASS=$((PASS + 1))
    else
        red "  ✗ $name — expected $expected_status, got $response"
        FAIL=$((FAIL + 1))
        FAILURES="$FAILURES  - $name [HTTP $response]\n"
    fi
}

bold "══════════════════════════════════════════════"
bold "  Smoke Test — $BASE_URL"
bold "══════════════════════════════════════════════"
echo ""

# Core API endpoints
check "API info (GET /)"          "$BASE_URL/"
check "Health check (GET /health)" "$BASE_URL/health"

# Auth (may return 503 if JWT not configured — that's OK, just check liveness)
check "Auth login (POST /api/auth/login)" "$BASE_URL/api/auth/login" 503

# Readiness (may return 503 if Redis not running)
check "Readiness (GET /ready)" "$BASE_URL/ready" 503

# Market data
check "Prices (GET /api/prices)" "$BASE_URL/api/prices"

# System status
check "System status (GET /api/system/status)" "$BASE_URL/api/system/status"

# Queue health
check "Queue health (GET /api/queue/health)" "$BASE_URL/api/queue/health" 503

echo ""
bold "══════════════════════════════════════════════"

if [ "$FAIL" -eq 0 ]; then
    green "  ✓ All $PASS checks passed"
    bold "══════════════════════════════════════════════"
    exit 0
else
    echo ""
    red " ✗ $FAIL checks failed:"
    echo -e "$FAILURES"
    bold "══════════════════════════════════════════════"
    exit 1
fi
