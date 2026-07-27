# Asset Operations

Browse the asset catalog and get asset details.

## List All Enabled Assets

```bash
curl -s "$API_BASE/api/v1/assets" | jq
```

## List Assets with Pagination

```bash
curl -s "$API_BASE/api/v1/assets?page=1&limit=10" | jq
```

## List Assets Sorted by Symbol

```bash
curl -s "$API_BASE/api/v1/assets?sort=symbol&order=asc" | jq
```

## Get Asset by Symbol

```bash
curl -s "$API_BASE/api/v1/assets/XLM" | jq
```

## Get Asset by Symbol (Case-Insensitive)

```bash
curl -s "$API_BASE/api/v1/assets/btc" | jq
```

## Filter Assets by Name

```bash
curl -s "$API_BASE/api/v1/assets?search=stellar" | jq
```

## List All Assets (Including Disabled) - Admin Only

```bash
curl -s "$API_BASE/api/v1/admin/assets" | jq
```

## Get Rate Limit Metrics - Admin Only

```bash
curl -s "$API_BASE/api/v1/admin/rate-limits/metrics" | jq
```

## Refresh Specific Asset - Admin Only

```bash
curl -X POST "$API_BASE/api/v1/admin/assets/XLM/refresh" | jq
```

## Batch Refresh All Assets - Admin Only

```bash
curl -X POST "$API_BASE/api/v1/admin/assets/refresh" | jq
```
