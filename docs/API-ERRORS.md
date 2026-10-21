# API Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| NOT_FOUND | 404 | Resource not found |
| VALIDATION_ERROR | 400 | Invalid request body |
| UNAUTHORIZED | 401 | Missing or invalid token |
| RATE_LIMITED | 429 | Too many requests |
| CONFLICT | 409 | Resource conflict (e.g. concurrent rebalance in progress) |
| INTERNAL_ERROR | 500 | Unexpected server error |
