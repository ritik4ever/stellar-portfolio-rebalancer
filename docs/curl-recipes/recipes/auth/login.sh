#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== POST /api/auth/login (JWT login) ==="
curl -sS -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"address": "GA123...", "signature": "0x..."}'
echo ""
