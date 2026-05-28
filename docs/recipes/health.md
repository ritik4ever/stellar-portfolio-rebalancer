# Health Check Recipes

## Basic Health Check

```bash
curl -s http://localhost:3000/api/health | jq .
```

## Deep Health Check

```bash
curl -s http://localhost:3000/api/health/deep | jq .
```
