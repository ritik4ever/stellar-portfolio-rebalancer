#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

echo "=== POST /api/notifications/subscribe (Subscribe) ==="
curl -sS -X POST "$BASE_URL/api/notifications/subscribe" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen 2>/dev/null || date +%s)" \
  -d '{
    "userId": "GA123...",
    "email": "user@example.com",
    "webhook": "https://hooks.example.com/alerts",
    "events": ["rebalance_executed", "threshold_breached", "error"]
  }'
echo ""

echo "=== GET /api/notifications/preferences (Get preferences) ==="
curl -sS "$BASE_URL/api/notifications/preferences?userId=GA123..." \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== DELETE /api/notifications/unsubscribe (Unsubscribe) ==="
curl -sS -X DELETE "$BASE_URL/api/notifications/unsubscribe?userId=GA123..." \
  -H "Authorization: Bearer $TOKEN"
echo ""
