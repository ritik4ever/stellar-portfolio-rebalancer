# System Status Endpoint (Issue #256)

## Overview

The `/api/system/status` endpoint provides a single, public operational status view for the Stellar Portfolio Rebalancer system. It aggregates system health information from multiple components without exposing sensitive configuration.

## Endpoint

```
GET /api/system/status
```

**Response Status**: 200 OK (operational) or 200 OK (degraded status field)

## Response Schema

```typescript
{
  "system": {
    "status": "operational" | "degraded",
    "uptime": number,           // Process uptime in seconds
    "timestamp": string,        // ISO 8601 timestamp
    "version": string          // API version (e.g., "1.0.0")
  },
  "portfolios": {
    "total": number,
    "active": number
  },
  "rebalanceHistory": {
    "totalEvents": number,
    "portfolios": number,
    "recentActivity": number,
    "autoRebalances": number
  },
  "riskManagement": {
    "circuitBreakers": {
      [key: string]: { isTriggered: boolean, reason?: string }
    },
    "enabled": boolean,
    "alertsActive": boolean
  },
  "autoRebalancer": {
    "status": {
      "isRunning": boolean,
      "message"?: string,
      "lastCheck"?: number
    },
    "statistics": {
      "totalRuns": number,
      "successCount": number,
      "failureCount": number,
      "lastRun"?: string
    },
    "enabled": boolean
  },
  "onChainIndexer": {
    "enabled": boolean,
    "status": "healthy" | "degraded" | "offline",
    "lastBlock"?: number,
    "lag"?: number
  },
  "services": {
    "priceFeeds": boolean,          // Backend price API healthy
    "riskManagement": boolean,      // Risk calculation service active
    "webSockets": boolean,          // WebSocket server operational
    "autoRebalancing": boolean,     // Auto-rebalancer running
    "stellarNetwork": boolean,      // Stellar network connectivity
    "contractEventIndexer": boolean // On-chain event indexer active
  },
  "featureFlags": {
    // Public-only feature flags (sensitive ones excluded)
    "enableDebugRoutes": boolean,
    "enableAutoRebalancing": boolean,
    // ... other public flags
  }
}
```

## Use Cases

### Frontend Dashboard
```typescript
// Check system operational state before displaying portfolio
const status = await api.get<SystemStatus>('/api/system/status')
if (status.system.status === 'degraded') {
  displayWarning('Some system services are degraded')
}
```

### Operational Monitoring
```typescript
// Monitor queue health and auto-rebalancer status
const status = await api.get<SystemStatus>('/api/system/status')
const queueHealthy = status.services.autoRebalancing && 
                     Object.values(status.riskManagement.circuitBreakers)
                       .every(cb => !cb.isTriggered)
```

### Deployment & Startup Verification
```typescript
// Verify all critical services are ready after deployment
const status = await api.get<SystemStatus>('/api/system/status')
const allServicesReady = Object.values(status.services).every(healthy => healthy)
```

### Incident Debugging
```typescript
// Identify which services are failing during an incident
const status = await api.get<SystemStatus>('/api/system/status')
const failedServices = Object.entries(status.services)
  .filter(([_, healthy]) => !healthy)
  .map(([name, _]) => name)
```

## Security Considerations

### What Is Exposed
- System health metrics (safe to expose)
- Public feature flag states (filtered for safety)
- Service availability status (no connection strings or credentials)
- Generic error states (no stack traces or internal details)
- API version (for compatibility checks)

### What Is NOT Exposed
- Database credentials or connection strings
- API keys or authentication tokens
- Stellar network private keys
- Internal configuration details (unless marked as public)
- Sensitive feature flag values
- User data or portfolio information
- Debug/admin endpoints availability (unless in development mode)

## Implementation Location

**File**: [backend/src/api/ops.routes.ts](../../backend/src/api/ops.routes.ts#L45)

**Router Registration**: [backend/src/api/routes.ts](../../backend/src/api/routes.ts) mounts `opsRouter` at root level

**Mount Point**: `/api/system/status` (mounted at `/api/` in Express app)

## Component Integration

### Data Sources

| Component | Source | Method |
|-----------|--------|--------|
| Portfolio Count | `portfolioStorage` | `getPortfolioCount()` |
| Rebalance History | `rebalanceHistoryService` | `getHistoryStats()` |
| Circuit Breakers | `riskManagementService` | `getCircuitBreakerStatus()` |
| Price Sources | `reflectorService` | `getCurrentPrices()` |
| Auto-Rebalancer | `autoRebalancer` | `getStatus()`, `getStatistics()` |
| On-Chain Indexer | `contractEventIndexerService` | `getStatus()` |
| Feature Flags | Feature flag service | Public flags only |

### Error Handling

- Transient service failures (e.g., price fetch timeout) mark that service as degraded in response
- Overall `system.status` is "degraded" if any critical service is unhealthy
- Errors are logged but don't crash the endpoint (returns available information)

## Testing

### Example Request / Response

**Request**:
```bash
curl -X GET https://api.stellar-portfolio.com/api/system/status
```

**Response** (200 OK - Operational):
```json
{
  "success": true,
  "data": {
    "system": {
      "status": "operational",
      "uptime": 86400,
      "timestamp": "2026-03-30T12:34:56.789Z",
      "version": "1.0.0"
    },
    "portfolios": {
      "total": 42,
      "active": 40
    },
    "services": {
      "priceFeeds": true,
      "riskManagement": true,
      "webSockets": true,
      "autoRebalancing": true,
      "stellarNetwork": true,
      "contractEventIndexer": true
    },
    "featureFlags": {
      "enableAutoRebalancing": true,
      "enableDebugRoutes": false
    }
  },
  "timestamp": "2026-03-30T12:34:56.789Z"
}
```

**Response** (200 OK - Degraded):
```json
{
  "success": true,
  "data": {
    "system": {
      "status": "degraded",
      "uptime": 86400,
      "timestamp": "2026-03-30T12:35:00.000Z",
      "version": "1.0.0"
    },
    "services": {
      "priceFeeds": false,
      "riskManagement": true,
      "webSockets": true,
      "autoRebalancing": true,
      "stellarNetwork": true,
      "contractEventIndexer": true
    }
  },
  "timestamp": "2026-03-30T12:35:00.000Z"
}
```

## Frontend Usage Example

```typescript
// In a dashboard component
import { api } from '@/config/api'

interface SystemStatus {
  system: {
    status: 'operational' | 'degraded'
    uptime: number
    timestamp: string
    version: string
  }
  services: Record<string, boolean>
  featureFlags: Record<string, boolean>
}

export function SystemHealthBadge() {
  const [status, setStatus] = useState<SystemStatus | null>(null)

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const data = await api.get<SystemStatus>('/api/system/status')
        setStatus(data)
      } catch (error) {
        console.error('Failed to fetch system status:', error)
      }
    }

    checkStatus()
    const interval = setInterval(checkStatus, 30000) // Poll every 30s
    return () => clearInterval(interval)
  }, [])

  if (!status) return null

  const isHealthy = status.system.status === 'operational'
  const failedServices = Object.entries(status.services)
    .filter(([_, healthy]) => !healthy)
    .map(([name, _]) => name)

  return (
    <div className={isHealthy ? 'text-green-600' : 'text-yellow-600'}>
      <span>System: {status.system.status}</span>
      {failedServices.length > 0 && (
        <div className="text-sm mt-1">
          Issues: {failedServices.join(', ')}
        </div>
      )}
    </div>
  )
}
```

## Related Endpoints

- **GET /health** - Lightweight health check (minimal response)
- **GET /api/queue/health** - Detailed queue metrics and worker status
- **GET /api/risk/metrics/:portfolioId** - Portfolio-specific risk analysis
- **GET /api/system/status** - Unified operational status (this endpoint)

## Changelog

- **v1.0.0** - Initial implementation with unified status aggregation
