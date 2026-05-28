# Curl Recipes

## Prerequisites
```bash
# Set your API base URL
export BASE_URL="http://localhost:3000"
export API_KEY="your-api-key"
```

## Authentication

### Register
```bash
curl -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"securepass"}'
```

### Login
```bash
curl -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"securepass"}'
```

### Get Current User
```bash
curl "$BASE_URL/api/auth/me" \
  -H "Authorization: Bearer $API_KEY"
```

## Portfolios

### List Portfolios
```bash
curl "$BASE_URL/api/portfolios" \
  -H "Authorization: Bearer $API_KEY"
```

### Get Portfolio Details
```bash
curl "$BASE_URL/api/portfolios/{id}" \
  -H "Authorization: Bearer $API_KEY"
```

### Create Portfolio
```bash
curl -X POST "$BASE_URL/api/portfolios" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Portfolio","assets":[{"code":"USDC","issuer":"GB...","target":0.5},{"code":"XLM","target":0.5}]}'
```

## Rebalancing

### Trigger Rebalance
```bash
curl -X POST "$BASE_URL/api/portfolios/{id}/rebalance" \
  -H "Authorization: Bearer $API_KEY"
```

### Get Rebalance History
```bash
curl "$BASE_URL/api/portfolios/{id}/rebalances" \
  -H "Authorization: Bearer $API_KEY"
```

### Get Rebalance Status
```bash
curl "$BASE_URL/api/rebalances/{id}" \
  -H "Authorization: Bearer $API_KEY"
```

## Health Check
```bash
curl "$BASE_URL/health"
# Expected: {"status":"ok","service":"stellar-portfolio-rebalancer"}
```
