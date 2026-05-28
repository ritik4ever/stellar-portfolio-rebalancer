#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

PORTFOLIO_ID="${1:-your-portfolio-id}"
USER_ADDRESS="${2:-GA123...}"

echo "=== GET /api/portfolio/{id}/analytics (Analytics) ==="
curl -sS "$BASE_URL/api/portfolio/$PORTFOLIO_ID/analytics?days=30" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== GET /api/portfolio/{id}/performance-summary ==="
curl -sS "$BASE_URL/api/portfolio/$PORTFOLIO_ID/performance-summary" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== GET /api/user/{address}/portfolios (List portfolios) ==="
curl -sS "$BASE_URL/api/user/$USER_ADDRESS/portfolios" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""
