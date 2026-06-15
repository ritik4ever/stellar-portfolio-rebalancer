#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

echo "=== POST /api/auth/logout (Logout) ==="
curl -sS -X POST "$BASE_URL/api/auth/logout" \
  -H "Authorization: Bearer $TOKEN"
echo ""
