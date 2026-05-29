# Prices and health checks

These curl examples help you confirm the backend is running, inspect market prices, and verify system status.

## 1. Check API health

```bash
curl http://localhost:3001/api/v1/health
```

## 2. Check readiness

```bash
curl http://localhost:3001/api/v1/ready
```

## 3. Get current prices

```bash
curl http://localhost:3001/api/v1/prices
```

## 4. Get enhanced prices with risk metadata

```bash
curl http://localhost:3001/api/v1/prices/enhanced
```

## 5. Get a rebalance plan for a portfolio

```bash
curl http://localhost:3001/api/v1/portfolio/<PORTFOLIO_ID>/rebalance-plan
```

Replace `<PORTFOLIO_ID>` with a real portfolio ID.
