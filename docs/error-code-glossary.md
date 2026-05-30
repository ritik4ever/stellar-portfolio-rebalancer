# API Error Code Glossary

| Code | Description | HTTP Status | Action |
|------|-------------|-------------|--------|
| `INVALID_REQUEST` | Malformed request body or parameters | 400 | Fix request format |
| `VALIDATION_ERROR` | Input validation failed | 400 | Check field constraints |
| `UNAUTHORIZED` | Missing or invalid authentication | 401 | Provide valid credentials |
| `FORBIDDEN` | Insufficient permissions | 403 | Request access from admin |
| `NOT_FOUND` | Resource does not exist | 404 | Verify resource ID |
| `RATE_LIMITED` | Too many requests | 429 | Retry after rate limit resets |
| `INTERNAL_ERROR` | Unexpected server error | 500 | Contact support |
| `SERVICE_UNAVAILABLE` | Temporary outage | 503 | Retry after brief delay |
| `INSUFFICIENT_BALANCE` | Account has insufficient XLM | 400 | Fund the account |
| `CONTRACT_ERROR` | Soroban contract execution failed | 500 | Check contract logs |
| `STELLAR_NETWORK_ERROR` | Stellar network request failed | 502 | Retry, check network status |
| `INVALID_SIGNATURE` | Transaction signature is invalid | 400 | Re-sign with correct key |
