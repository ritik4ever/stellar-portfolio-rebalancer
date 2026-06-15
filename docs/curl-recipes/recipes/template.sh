#!/usr/bin/env bash
# Recipe template — copy this to add a new endpoint
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== Request ==="
echo "METHOD /path"

echo ""
echo "=== Response ==="
curl -sS "$BASE_URL/path" | jq .
