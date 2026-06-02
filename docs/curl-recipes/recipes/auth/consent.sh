#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== POST /api/consent (Record consent) ==="
curl -sS -X POST "$BASE_URL/api/consent" \
  -H "Content-Type: application/json" \
  -d '{"userId": "GA123...", "consentVersion": "1.0", "acceptedAt": "2026-05-28T00:00:00Z"}'
echo ""
