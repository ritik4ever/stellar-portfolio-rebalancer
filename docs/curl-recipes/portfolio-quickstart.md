# Portfolio workflow

Use these curl recipes to create a portfolio, review its details, plan a rebalance, and execute a rebalance.

## 1. Check backend health

```bash
curl http://localhost:3001/api/v1/health
```

## 2. Create a portfolio

```bash
curl -X POST http://localhost:3001/api/v1/portfolio \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "userAddress": "GABCEXAMPLE1234567890",
    "allocations": {
      "XLM": 40,
      "USDC": 40,
      "BTC": 20
    },
    "threshold": 5,
    "slippageTolerance": 1
  }'
```

The response contains a `portfolioId` value. Save it for the next requests.

## 3. Get portfolio details

```bash
curl http://localhost:3001/api/v1/portfolio/<PORTFOLIO_ID>
```

Replace `<PORTFOLIO_ID>` with the ID returned by the create call.

## 4. Get the rebalance plan

```bash
curl http://localhost:3001/api/v1/portfolio/<PORTFOLIO_ID>/rebalance-plan
```

This returns estimated portfolio value, current prices, and the plan that would be used for rebalance.

## 5. Execute a manual rebalance

```bash
curl -X POST http://localhost:3001/api/v1/portfolio/<PORTFOLIO_ID>/rebalance \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000"
```

The request body is optional for the current API implementation.

## 6. List portfolios for a user

```bash
curl http://localhost:3001/api/v1/user/GABCEXAMPLE1234567890/portfolios
```

Replace the address with the same `userAddress` used when creating the portfolio.
