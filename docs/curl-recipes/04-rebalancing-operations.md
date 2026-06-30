# Rebalancing Operations

Trigger rebalances, check history, and manage rebalance operations.

## Trigger Manual Rebalance

```bash
curl -X POST "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "triggeredBy": "manual"
  }' | jq
```

## Trigger Rebalance with Options

```bash
curl -X POST "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "triggeredBy": "manual",
    "force": true,
    "skipRiskChecks": false
  }' | jq
```

## Get Rebalance History for Portfolio

```bash
curl -s "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/history" | jq
```

## Get Rebalance History with Filters

```bash
curl -s "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/history?status=completed&limit=10" | jq
```

## Get Automatic Rebalance History

```bash
curl -s "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/history?isAutomatic=true" | jq
```

## Get Recent Rebalance History

```bash
curl -s "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/history?limit=5" | jq
```

## Get Rebalance History Since Date

```bash
curl -s "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/history?since=2024-01-01T00:00:00Z" | jq
```

## Get Rebalance History Stats

```bash
curl -s "$API_BASE/api/v1/rebalancing/history/stats" | jq
```

## Get Rebalance History Stats for Portfolio

```bash
curl -s "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/history/stats" | jq
```

## Dry Run Rebalance

```bash
curl -X POST "$API_BASE/api/v1/rebalancing/PORTFOLIO_ID/dry-run" \
  -H "Content-Type: application/json" \
  -d '{
    "triggeredBy": "manual"
  }' | jq
```

## Get Rebalance by Event ID

```bash
curl -s "$API_BASE/api/v1/rebalancing/events/EVENT_ID" | jq
```
