#!/bin/bash
# Seed staging environment with test data
# Usage: ./scripts/seed-staging.sh [url]

URL="${1:-http://localhost:3000}"

echo "🌱 Seeding $URL with test data..."

# Create test portfolio
curl -s -X POST "$URL/api/portfolios" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Portfolio","assets":[{"code":"XLM","target":0.5},{"code":"USDC","target":0.5}]}'

echo ""
echo "✅ Staging seeded. Reset with: ./scripts/reset-staging.sh"
