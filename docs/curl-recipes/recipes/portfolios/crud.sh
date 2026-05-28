#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

echo "=== POST /api/portfolio (Create portfolio) ==="
curl -sS -X POST "$BASE_URL/api/portfolio" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen 2>/dev/null || date +%s)" \
  -d '{
    "userAddress": "GA123...",
    "allocations": {"XLM": 50, "USDC": 30, "ETH": 20},
    "threshold": 5,
    "slippageTolerance": 1.0
  }'
echo ""

echo "=== GET /api/portfolio/{id} (Get portfolio) ==="
PORTFOLIO_ID="${1:-your-portfolio-id}"
curl -sS "$BASE_URL/api/portfolio/$PORTFOLIO_ID" \
  -H "Authorization: Bearer $TOKEN"
echo ""
