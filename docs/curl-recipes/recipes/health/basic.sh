#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-your-jwt-token}"

echo "=== GET / (API info) ==="
curl -sS "$BASE_URL/" | jq .
echo ""

echo "=== GET /health (Health check) ==="
curl -sS "$BASE_URL/health" | jq .
echo ""

echo "=== GET /ready (Deep readiness) ==="
curl -sS "$BASE_URL/ready" | jq .
echo ""
