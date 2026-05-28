# API Error Code Glossary

This document lists the API error codes returned by the Stellar Portfolio Rebalancer backend.

## Error Format

All error responses follow this structure:

\`\`\`json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
\`\`\`

## Error Codes

| Code | HTTP Status | Description | Example |
|------|-------------|-------------|---------|
| VALIDATION_ERROR | 400 | Input validation failed | Missing required field |
| UNAUTHORIZED | 401 | Authentication required | Invalid signature |
| NOT_FOUND | 404 | Resource not found | Portfolio ID does not exist |
| RATE_LIMITED | 429 | Too many requests | Try again later |
| INTERNAL_ERROR | 500 | Unexpected server error | Contact support |

## Examples

### Validation Error
\`\`\`bash
curl -s -X POST http://localhost:3000/api/rebalance -H "Content-Type: application/json" -d '{}' | jq
\`\`\`

### Not Found
\`\`\`bash
curl -s http://localhost:3000/api/portfolio/invalid-id | jq
\`\`\`
