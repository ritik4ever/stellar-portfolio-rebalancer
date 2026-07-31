# Rebalancing Recipes

## Trigger a Rebalance

```bash
curl -s -X POST http://localhost:3000/api/rebalance \
  -H "Content-Type: application/json" \
  -d '{"portfolioId": "portfolio_123"}' | jq .
```

## Get Rebalance Status

```bash
curl -s http://localhost:3000/api/rebalance/status/rb_456 | jq .
```

## List Rebalance History

```bash
curl -s "http://localhost:3000/api/rebalance?portfolioId=portfolio_123&limit=10" | jq .
```
