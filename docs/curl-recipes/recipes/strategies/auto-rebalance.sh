#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

echo "=== GET /api/auto-rebalancer/status ==="
curl -sS "$BASE_URL/api/auto-rebalancer/status" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== POST /api/auto-rebalancer/start (Start — admin) ==="
curl -sS -X POST "$BASE_URL/api/auto-rebalancer/start" \
  -H "Authorization: Bearer $TOKEN"
echo ""

echo "=== POST /api/auto-rebalancer/stop (Stop — admin) ==="
curl -sS -X POST "$BASE_URL/api/auto-rebalancer/stop" \
  -H "Authorization: Bearer $TOKEN"
echo ""

echo "=== POST /api/auto-rebalancer/force-check (Force — admin) ==="
curl -sS -X POST "$BASE_URL/api/auto-rebalancer/force-check" \
  -H "Authorization: Bearer $TOKEN"
echo ""

echo "=== GET /api/auto-rebalancer/history (History — admin) ==="
curl -sS "$BASE_URL/api/auto-rebalancer/history?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""
