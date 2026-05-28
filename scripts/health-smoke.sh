#!/bin/bash
set -euo pipefail

# Health smoke test script
# Usage: ./scripts/health-smoke.sh [url]
# Default: http://localhost:3000

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

check_endpoint() {
  local endpoint="$1"
  local description="$2"
  local expected_code="${3:-200}"

  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint" 2>/dev/null || echo "000")

  if [ "$http_code" = "$expected_code" ]; then
    echo "  ✅ $description ($http_code)"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $description — expected $expected_code, got $http_code"
    FAIL=$((FAIL + 1))
  fi
}

echo "🔍 Health smoke test for $BASE_URL"
echo ""

check_endpoint "/api/health" "Basic health check" 200
check_endpoint "/api/health/deep" "Deep health check" 200

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
