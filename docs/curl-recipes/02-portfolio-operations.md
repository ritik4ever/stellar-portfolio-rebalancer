# Portfolio Operations

Create, read, update, and delete portfolios.

## Create a Portfolio

```bash
curl -X POST "$API_BASE/api/v1/portfolios" \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "GABCD...",
    "allocations": {
      "XLM": 40,
      "BTC": 30,
      "ETH": 20,
      "USDC": 10
    },
    "threshold": 5,
    "slippageTolerance": 1,
    "strategy": "threshold",
    "strategyConfig": {}
  }' | jq
```

## Get All Portfolios

```bash
curl -s "$API_BASE/api/v1/portfolios" | jq
```

## Get Portfolio by ID

```bash
curl -s "$API_BASE/api/v1/portfolios/PORTFOLIO_ID" | jq
```

## Get User Portfolios

```bash
curl -s "$API_BASE/api/v1/portfolios/user/GABCD..." | jq
```

## Update Portfolio

```bash
curl -X PUT "$API_BASE/api/v1/portfolios/PORTFOLIO_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "allocations": {
      "XLM": 35,
      "BTC": 35,
      "ETH": 20,
      "USDC": 10
    },
    "threshold": 7,
    "slippageTolerance": 1.5
  }' | jq
```

## Update Portfolio with Version (Optimistic Concurrency)

```bash
curl -X PUT "$API_BASE/api/v1/portfolios/PORTFOLIO_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "allocations": {
      "XLM": 35,
      "BTC": 35,
      "ETH": 20,
      "USDC": 10
    },
    "threshold": 7,
    "expectedVersion": 1
  }' | jq
```

## Delete Portfolio

```bash
curl -X DELETE "$API_BASE/api/v1/portfolios/PORTFOLIO_ID" | jq
```

## Get Portfolio Analytics

```bash
curl -s "$API_BASE/api/v1/portfolios/PORTFOLIO_ID/analytics" | jq
```

## Export Portfolio as JSON

```bash
curl -s "$API_BASE/api/v1/portfolios/PORTFOLIO_ID/export?format=json" | jq
```

## Export Portfolio as CSV

```bash
curl -s "$API_BASE/api/v1/portfolios/PORTFOLIO_ID/export?format=csv" -o portfolio.csv
```

## Get Portfolio Count

```bash
curl -s "$API_BASE/api/v1/portfolios/count" | jq
```
