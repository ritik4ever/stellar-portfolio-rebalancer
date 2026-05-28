# API Error Code Glossary

## Authentication Errors

| Code | HTTP Status | Description | Remediation |
|------|-------------|-------------|-------------|
| `ERR_UNAUTHORIZED` | 401 | Missing or invalid API key | Include a valid API key in the `Authorization` header |
| `ERR_EXPIRED_TOKEN` | 401 | Authentication token has expired | Re-authenticate to obtain a new token |
| `ERR_FORBIDDEN` | 403 | Insufficient permissions | Check that your API key has the required scope |

## Request Errors

| Code | HTTP Status | Description | Remediation |
|------|-------------|-------------|-------------|
| `ERR_BAD_REQUEST` | 400 | Malformed request body | Verify JSON syntax and required fields |
| `ERR_VALIDATION` | 422 | Request failed validation | Check field types and constraints |
| `ERR_NOT_FOUND` | 404 | Resource not found | Verify the resource ID |

## Wallet Errors

| Code | HTTP Status | Description | Remediation |
|------|-------------|-------------|-------------|
| `ERR_BAD_SIGNATURE` | 400 | Signature mismatch | Reconnect wallet and retry |
| `ERR_WRONG_NETWORK` | 400 | Wallet on wrong network | Switch wallet to Testnet or Mainnet |
| `ERR_EXPIRED` | 408 | Request timed out | Close and retry |

## Portfolio Errors

| Code | HTTP Status | Description | Remediation |
|------|-------------|-------------|-------------|
| `ERR_INSUFFICIENT_BALANCE` | 400 | Not enough funds to execute rebalance | Add funds or adjust allocation |
| `ERR_ASSET_NOT_SUPPORTED` | 400 | Asset not in supported list | Use a supported Stellar asset |
| `ERR_DRIFT_TOO_SMALL` | 400 | Drift below minimum threshold | Wait until drift exceeds configured threshold |

## Server Errors

| Code | HTTP Status | Description | Remediation |
|------|-------------|-------------|-------------|
| `ERR_INTERNAL` | 500 | Unexpected server error | Retry; contact maintainers if persistent |
| `ERR_SERVICE_UNAVAILABLE` | 503 | Dependency unavailable | Retry with exponential backoff |
