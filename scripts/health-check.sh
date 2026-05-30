#!/bin/bash
# Health smoke test for local, staging, and production URLs
# Usage: ./scripts/health-check.sh [url]

URL="${1:-http://localhost:3000}"
FAIL=0

echo "🔍 Health smoke test: $URL"
echo ""

check() {
  local label="$1"
  local endpoint="$2"
  local expected="$3"
  
  response=$(curl -s -o /dev/null -w "%{http_code}" "$URL$endpoint" 2>/dev/null)
  if [ "$response" = "$expected" ]; then
    echo "  ✅ $label ($endpoint → $response)"
  else
    echo "  ❌ $label ($endpoint → $response, expected $expected)"
    FAIL=1
  fi
}

check "Health" "/api/health" "200"
check "API" "/api/portfolios" "200"

if [ $FAIL -eq 0 ]; then
  echo ""
  echo "✅ All health checks passed"
else
  echo ""
  echo "❌ Some checks failed"
  exit 1
fi
