#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

PORTFOLIO_ID="${1:-your-portfolio-id}"

echo "=== GET /api/risk/metrics/{portfolioId} ==="
curl -sS "$BASE_URL/api/risk/metrics/$PORTFOLIO_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== GET /api/risk/check/{portfolioId} (Risk check) ==="
curl -sS "$BASE_URL/api/risk/check/$PORTFOLIO_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""
