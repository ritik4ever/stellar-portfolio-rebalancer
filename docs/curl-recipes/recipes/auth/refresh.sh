#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

echo "=== POST /api/auth/refresh (Refresh JWT) ==="
curl -sS -X POST "$BASE_URL/api/auth/refresh" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "your-refresh-token"}'
echo ""
