# Rate Limiting Implementation

## Overview

The Stellar Portfolio Rebalancer API implements comprehensive rate limiting to protect against abuse and accidental overload. The system uses Redis for distributed rate limiting across multiple instances and provides detailed monitoring and alerting.

## Architecture

### Multi-Tier Rate Limiting

1. **Burst Protection** (10-second window)
   - Global: 20 requests per 10 seconds
   - Write operations: 3 requests per 10 seconds
   - Prevents rapid-fire attacks and accidental loops

2. **Standard Rate Limiting** (60-second window)
   - Global: 100 requests per minute
   - Write operations: 10 requests per minute
   - Authentication: 5 requests per minute
   - Critical operations: 3 requests per minute
   - Admin operations: 5 requests per minute

### Key Features

- **Redis Store**: Shared rate limiting across multiple instances
- **IP + Wallet Address Throttling**: Authenticated requests are tracked by both IP and wallet address
- **Endpoint-Specific Policies**: Different limits for read vs write vs critical operations
- **Comprehensive Monitoring**: Detailed metrics and alerting for suspicious activity
- **Graceful Degradation**: Falls back to memory store if Redis is unavailable

## Rate Limiting Policies

### Global Rate Limiter
- **Scope**: All requests
- **Limit**: 100 requests per minute
- **Key**: IP address (+ wallet address if authenticated)
- **Applied to**: Every request except health checks

### Burst Protection
- **Scope**: All requests
- **Limit**: 20 requests per 10 seconds
- **Purpose**: Prevent rapid-fire attacks
- **Applied to**: Every request except health checks and metrics

### Write Operations
- **Scope**: POST, PUT, DELETE operations
- **Limits**: 
  - 10 requests per minute (standard)
  - 3 requests per 10 seconds (burst protection)
- **Applied to**: Portfolio creation, rebalancing, consent recording, notifications

### Critical Operations
- **Scope**: High-value operations
- **Limits**:
  - 3 requests per minute (standard)
  - Burst protection also applies
- **Applied to**: Portfolio rebalancing, user data deletion

### Authentication
- **Scope**: Login, refresh, logout endpoints
- **Limit**: 5 requests per minute
- **Purpose**: Prevent brute force attacks
- **Never skipped**: Always enforced regardless of response status

### Admin Operations
- **Scope**: Admin-only endpoints
- **Limit**: 5 requests per minute
- **Applied to**: Asset management, auto-rebalancer control, metrics access

## Configuration

### Environment Variables

```bash
# Global rate limiting
RATE_LIMIT_WINDOW_MS=60000          # 1 minute window
RATE_LIMIT_MAX=100                  # 100 requests per window

# Write operations
RATE_LIMIT_WRITE_MAX=10             # 10 write requests per window

# Authentication endpoints
RATE_LIMIT_AUTH_MAX=5               # 5 auth requests per window

# Critical operations
RATE_LIMIT_CRITICAL_MAX=3           # 3 critical requests per window

# Burst protection
RATE_LIMIT_BURST_WINDOW_MS=10000    # 10 second burst window
RATE_LIMIT_BURST_MAX=20             # 20 requests per burst window
RATE_LIMIT_WRITE_BURST_MAX=3        # 3 write requests per burst window

# Redis connection for distributed rate limiting
REDIS_URL=redis://localhost:6379
```

## Key Generation Strategy

The rate limiting system uses intelligent key generation to provide both IP-based and user-based throttling:

```typescript
// For authenticated requests
key = "prefix:ip:wallet_address"

// For unauthenticated requests  
key = "prefix:ip"
```

This approach ensures that:
- Authenticated users can't bypass limits by switching IPs easily
- Multiple users behind the same NAT/proxy don't interfere with each other
- Unauthenticated requests are still properly throttled by IP

## Monitoring and Alerting

### Metrics Tracked

- Total requests processed
- Total requests throttled
- Throttle rate percentage
- Throttling by limit type (global, write, auth, etc.)
- Throttling by endpoint
- Throttling by IP address
- Throttling by user address

### Suspicious Activity Detection

The system automatically detects and alerts on suspicious patterns:

- **Medium Alert**: 50+ throttles from single IP or 25+ from single user
- **Critical Alert**: 100+ throttles (suggests potential ban consideration)

### Admin Monitoring Endpoint

```
GET /api/admin/rate-limits/metrics
```

Returns comprehensive rate limiting metrics including:
- Current metrics and throttle rates
- Top offending IPs and users
- Most throttled endpoints
- Detailed activity report

## Response Format

When a request is rate limited, the API returns:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded for write-operations. Please try again later.",
    "details": {
      "limitType": "write-operations",
      "retryAfter": 60,
      "endpoint": "POST /api/portfolio"
    }
  },
  "timestamp": "2026-02-26T10:30:00.000Z",
  "meta": {
    "retryAfter": 60,
    "limitType": "write-operations",
    "endpoint": "POST /api/portfolio"
  }
}
```

### Headers

- `Retry-After`: Seconds until the client can retry
- `X-RateLimit-Limit-Type`: Type of rate limit that was exceeded
- Standard rate limiting headers per RFC draft-7

## Implementation Details

### Middleware Stack

1. **Request Context**: Adds request ID and logging
2. **Request Monitoring**: Records requests for metrics
3. **Burst Protection**: Short-window rapid-fire protection
4. **Global Rate Limiting**: Standard per-minute limits
5. **Endpoint-Specific Limits**: Applied per route as needed

### Redis Integration

- Uses `rate-limit-redis` store for distributed limiting
- Graceful fallback to memory store if Redis unavailable
- Proper connection cleanup on shutdown
- Connection sharing with BullMQ job queue system

### Error Handling

- Rate limiting failures don't block requests (fail-open)
- Detailed logging for troubleshooting
- Monitoring alerts for Redis connectivity issues

## Security Considerations

### Protection Against

- **DDoS Attacks**: Multi-tier limiting with burst protection
- **Brute Force**: Strict limits on authentication endpoints
- **Resource Exhaustion**: Critical operation limits
- **Accidental Loops**: Burst protection catches runaway clients

### Bypass Prevention

- IP + wallet address combination prevents easy circumvention
- No bypass for successful requests on critical endpoints
- Admin endpoints always enforce limits
- Health checks excluded to prevent monitoring interference

## Operational Procedures

### Monitoring

1. Check `/api/admin/rate-limits/metrics` regularly
2. Monitor logs for rate limiting alerts
3. Watch for patterns in throttled requests
4. Review top offenders weekly

### Incident Response

1. **High Throttle Rate**: Investigate for attacks or misconfigurations
2. **Critical Alerts**: Consider temporary IP/user blocks
3. **Redis Failures**: Verify fallback to memory store is working
4. **False Positives**: Adjust limits or whitelist legitimate traffic

### Maintenance

- Daily metrics reset automatically
- Redis connection health monitored
- Graceful shutdown ensures proper cleanup
- Configuration changes require restart

## Testing

### Load Testing

Test rate limiting under various scenarios:
- Single IP burst requests
- Distributed requests across IPs
- Authenticated vs unauthenticated traffic
- Redis availability/failure scenarios

### Verification

```bash
# Test global rate limiting
for i in {1..150}; do curl -s http://localhost:3001/api/health; done

# Test write rate limiting  
for i in {1..15}; do curl -s -X POST http://localhost:3001/api/consent -d '{}'; done

# Test burst protection
for i in {1..25}; do curl -s http://localhost:3001/api/assets & done; wait
```

## Future Enhancements

- Dynamic rate limit adjustment based on system load
- Whitelist/blacklist IP management
- Geographic rate limiting
- Machine learning-based anomaly detection
- Integration with external threat intelligence