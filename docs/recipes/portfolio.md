# Portfolio Recipes

## Create a Portfolio

```bash
curl -s -X POST http://localhost:3000/api/portfolios \
  -H "Content-Type: application/json" \
  -d '{"name": "My Balanced Portfolio", "assets": ["XLM", "USDC"]}' | jq .
```

## List Portfolios

```bash
curl -s http://localhost:3000/api/portfolios | jq .
```

## Get Portfolio Details

```bash
curl -s http://localhost:3000/api/portfolios/portfolio_123 | jq .
```
