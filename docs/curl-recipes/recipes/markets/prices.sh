#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

echo "=== GET /api/prices (Current prices) ==="
curl -sS "$BASE_URL/api/prices" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== GET /api/prices/enhanced (Prices + risk) ==="
curl -sS "$BASE_URL/api/prices/enhanced" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== GET /api/market/{asset}/details ==="
ASSET="${1:-XLM}"
curl -sS "$BASE_URL/api/market/$ASSET/details" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== GET /api/market/{asset}/chart (Chart history) ==="
curl -sS "$BASE_URL/api/market/$ASSET/chart?days=7" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""
