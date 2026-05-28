#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

PORTFOLIO_ID="${1:-your-portfolio-id}"

echo "=== GET /api/portfolio/{id}/rebalance-plan (Get plan) ==="
curl -sS "$BASE_URL/api/portfolio/$PORTFOLIO_ID/rebalance-plan" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== POST /api/portfolio/{id}/rebalance (Execute rebalance) ==="
curl -sS -X POST "$BASE_URL/api/portfolio/$PORTFOLIO_ID/rebalance" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"options": {"simulateOnly": true}}'
echo ""
