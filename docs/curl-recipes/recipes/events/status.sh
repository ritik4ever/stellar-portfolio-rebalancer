#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

echo "=== GET /api/rebalance/history (Rebalance history) ==="
curl -sS "$BASE_URL/api/rebalance/history?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== GET /api/system/status (System status) ==="
curl -sS "$BASE_URL/api/system/status" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== GET /api/queue/health (Queue health) ==="
curl -sS "$BASE_URL/api/queue/health" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""
