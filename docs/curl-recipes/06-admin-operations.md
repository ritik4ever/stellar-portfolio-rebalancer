# Admin Operations

Asset management, rate limit monitoring, and system administration.

**Note:** These routes require admin access. Your address must be in the `ADMIN_PUBLIC_KEYS` environment variable.

## Add New Asset

```bash
curl -X POST "$API_BASE/api/v1/admin/assets" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TOKEN",
    "name": "Token Name",
    "contractAddress": "C...",
    "issuerAccount": "G...",
    "coingeckoId": "token"
  }' | jq
```

## Remove Asset

```bash
curl -X DELETE "$API_BASE/api/v1/admin/assets/TOKEN" | jq
```

## Enable Asset

```bash
curl -X PUT "$API_BASE/api/v1/admin/assets/TOKEN/enable" | jq
```

## Disable Asset

```bash
curl -X PUT "$API_BASE/api/v1/admin/assets/TOKEN/disable" | jq
```

## Quarantine Asset

```bash
curl -X PUT "$API_BASE/api/v1/admin/assets/TOKEN/quarantine" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Suspicious activity detected"
  }' | jq
```

## Unquarantine Asset

```bash
curl -X PUT "$API_BASE/api/v1/admin/assets/TOKEN/unquarantine" | jq
```

## Refresh Specific Asset

```bash
curl -X POST "$API_BASE/api/v1/admin/assets/TOKEN/refresh" | jq
```

## Batch Refresh All Assets

```bash
curl -X POST "$API_BASE/api/v1/admin/assets/refresh" | jq
```

## Get Rate Limit Metrics

```bash
curl -s "$API_BASE/api/v1/admin/rate-limits/metrics" | jq
```

## Get Top Rate Limit Offenders

```bash
curl -s "$API_BASE/api/v1/admin/rate-limits/offenders?limit=10" | jq
```

## Reset Rate Limit for IP

```bash
curl -X POST "$API_BASE/api/v1/admin/rate-limits/reset" \
  -H "Content-Type: application/json" \
  -d '{
    "ip": "127.0.0.1"
  }' | jq
```

## Test Notification (Debug Route)

```bash
curl -X POST "$API_BASE/api/debug/notifications/test" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "GABCD...",
    "eventType": "rebalance"
  }' | jq
```

## Force Fresh Prices (Debug Route)

```bash
curl -s "$API_BASE/api/debug/force-fresh-prices" | jq
```

## Test Reflector Service (Debug Route)

```bash
curl -s "$API_BASE/api/debug/reflector-test" | jq
```

## Test CoinGecko API (Debug Route)

```bash
curl -s "$API_BASE/api/debug/coingecko-test" | jq
```

## Get Environment Info (Debug Route)

```bash
curl -s "$API_BASE/api/debug/env" | jq
```

## Test Auto-Rebalancer (Debug Route)

```bash
curl -s "$API_BASE/api/debug/auto-rebalancer-test" | jq
```
