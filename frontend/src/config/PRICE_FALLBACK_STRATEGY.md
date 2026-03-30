# Price Fallback Strategy (Issue #257)

## Overview

The frontend API layer implements an environment-aware price fallback strategy to balance convenience in development with production reliability. This document explains how prices are sourced and when fallbacks are used.

## Configuration by Environment

### Production Environment
- **Primary**: Backend API prices (`/api/v1/prices`)
- **Fallback**: Browser-side CoinGecko API only on explicit debug flag (`VITE_ENABLE_BROWSER_PRICE_DEBUG=true`)
- **Fallback Source**: CoinGecko browser API→ Hardcoded fallback prices
- **Rationale**: Backend failures are not masked; contributors and monitoring systems see explicit errors

### Development Environment
- **Primary**: Browser-side CoinGecko API (`api.coingecko.com`)
- **Fallback**: Backend API prices (`/api/v1/prices`)
- **Fallback Source**: Stale cached data → Hardcoded fallback prices
- **Rationale**: Convenience; developers can work offline or if backend is down

### Demo / Debug Mode
- **Control**: `VITE_ENABLE_BROWSER_PRICE_DEBUG=true` environment variable
- **Effect**: Forces browser-side prices regardless of production/dev status
- **Use Case**: Demonstrating frontend functionality without backend availability

## Price Source Tracking

Each price object includes a `source` field indicating its origin:

```typescript
interface PriceData {
    price: number
    change?: number
    timestamp: number
    source: string    // Tracks origin for debugging
    volume?: number
}
```

### Source Values

| Source | Meaning | Environment |
|--------|---------|-------------|
| `coingecko_browser` | Live prices from CoinGecko API fetched in browser | Dev or Debug |
| `fallback_browser` | Hardcoded price fallback in browser service | Dev or Debug (on error) |
| `backend_api` | Prices from backend reflector service | Production (default) |
| `backend_cached` | Backend prices from local cache | Production (on backend error) |

## Debugging Price Sources

### Browser DevTools Console

Enable debug logging to see price source information:

```typescript
// In browser console:
localStorage.setItem('STELLAR_DEBUG', 'true')
// Reload page
```

Debug logs show:
- Which price source strategy is active
- Whether browser prices or backend prices are being used
- Fallback transitions and errors
- Cache hit/miss information

### Example Log Output

**Development (Browser Prices Enabled)**:
```
Price source strategy: Browser prices enabled (development mode or debug flag)
  isDev: true
  debugFlagEnabled: false

Price source: Browser (CoinGecko API or fallback)
  assets: ["XLM", "USDC", "BTC", "ETH"]
  sourceSample: "coingecko_browser"
```

**Production (Backend Prices Enforced)**:
```
Price source strategy: Backend prices (production mode or browser fallback disabled)
  isDev: false
  browserPricesWouldBeEnabled: false

Price source: Backend API
  endpoint: "/api/v1/prices"
  assets: ["XLM", "USDC", "BTC", "ETH"]
  hasMeta: true
```

## Silent Failure Prevention

### How Production is Protected

1. **No Silent Fallback**: Production never silently switches to browser prices
   - Errors surface explicitly to monitoring/logging systems
   - Stale data scenarios are visible in error logs
   
2. **Explicit Debug Flag**: Browser prices in production require explicit opt-in
   - Demo deployments can set `VITE_ENABLE_BROWSER_PRICE_DEBUG=true`
   - One-time decision per deployment, not per API call

3. **Source Transparency**: Each price includes origin information
   - UI can display which data source was used
   - Reports can audit price origins
   - Debugging production issues is straightforward

### How Development Stays Convenient

1. **Browser First**: Development defaults to browser prices
   - Works offline; no backend/database required
   - Fast iteration without Redis/database setup

2. **Automatic Fallback**: On browser API error, falls back to backend
   - Same developer can work with or without backend
   - No need to switch environment variables

3. **Graceful Degradation**: Stale cache → hardcoded fallback
   - Reasonable defaults available even if all APIs fail
   - Sufficient for frontend layout/UX testing

## Implementation Details

### Configuration (frontend/src/config/api.ts)

```typescript
/**
 * Determines if browser-side price fetching should be used.
 * 
 * - Production: Disabled (always use backend prices)
 * - Development: Enabled (prefer browser prices, fallback to backend on error)
 * - Demo mode: Enabled via VITE_ENABLE_BROWSER_PRICE_DEBUG flag
 */
function shouldUseBrowserPrices(): boolean {
    const viteEnv = (import.meta as any).env
    
    // Explicit debug flag allows browser prices even in production
    if (viteEnv?.VITE_ENABLE_BROWSER_PRICE_DEBUG === 'true') {
        return true
    }
    
    // Production: default to backend
    if (viteEnv?.PROD === true || viteEnv?.MODE === 'production') {
        return false
    }
    
    // Development: default to browser prices
    return true
}
```

### Price Request Logic (apiRequest)

```typescript
if (API_CONFIG.USE_BROWSER_PRICES && endpoint.includes('/prices')) {
    try {
        // Browser prices with source tracking
        const prices = await browserPriceService.getCurrentPrices()
        // prices[asset].source is 'coingecko_browser' or 'fallback_browser'
        return prices
    } catch (error) {
        // Fall through to backend
    }
}

// Backend request (primary in production, fallback in development)
const response = await fetch(url, defaultOptions)
const body = await response.json()
// Track source as 'backend_api'
```

## Migration & Rollout

### From Old Behavior
- **Before**: `USE_BROWSER_PRICES: true` (hardcoded) always silently switched to browser prices
- **After**: `USE_BROWSER_PRICES: shouldUseBrowserPrices()` respects environment, logs explicitly

### For Existing Deployments
- **Production**: No change needed; backend prices already preferred
- **Development**: May see increased logging; backend prices used if browser fails
- **Demo**: Add `VITE_ENABLE_BROWSER_PRICE_DEBUG=true` to .env to enable browser prices

## Monitoring & Alerts

### Recommended Monitoring

1. **Backend Price Failures**: Monitor `/api/v1/prices` endpoint success rate in production
2. **Browser Price Fallbacks**: Log rate of `VITE_ENABLE_BROWSER_PRICE_DEBUG` usage in demo deployments
3. **Price Source Distribution**: Track which sources are used (backend, browser, fallback)
4. **Stale Data Incidents**: Alert if cache TTL exceeded without fresh data

### Debug Dashboard Metrics

Track per-session:
- Active price source strategy (backend/browser)
- Fallback transitions (count of backend→cache→hardcoded)
- Fetch latencies (backend vs. browser API)
- Error rates by source

## Contributing

When modifying price logic:

1. **Preserve Logging**: Maintain `debugLog` calls so contributors can trace price sources
2. **Test Both Paths**: Verify backend and browser code paths with integration tests
3. **Document Changes**: Update this file if fallback behavior changes
4. **Production Testing**: Ensure production-mode paths don't silently hide errors
