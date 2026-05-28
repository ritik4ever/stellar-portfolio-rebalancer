# Curl Recipes for Stellar Portfolio Rebalancer

This directory contains example `curl` commands for common API tasks.

## Prerequisites

- A running instance of the backend (local or deployed)
- `curl` installed on your machine

## Recipes

### Health Check
\`\`\`bash
curl -s http://localhost:3000/api/health | jq
\`\`\`

### Get Portfolio
\`\`\`bash
curl -s http://localhost:3000/api/portfolio | jq
\`\`\`

### Trigger Rebalance
\`\`\`bash
curl -s -X POST http://localhost:3000/api/rebalance \
  -H "Content-Type: application/json" \
  -d '{"strategy": "equal-weight"}' | jq
\`\`\`

### Get Rebalance History
\`\`\`bash
curl -s http://localhost:3000/api/rebalance/history | jq
\`\`\`

### Check Transaction Status
\`\`\`bash
curl -s http://localhost:3000/api/transactions/{tx_hash} | jq
\`\`\`
