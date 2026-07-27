# API Migration Guide: `/api` → `/api/v1`

This document describes the migration from the legacy unversioned `/api/*` namespace to the canonical `/api/v1/*` namespace.

## Timeline

| Date | Milestone |
|------|-----------|
| 2026-03-01 | `/api/v1/*` namespace introduced; both namespaces served identical responses |
| 2026-04-01 | Legacy `/api/*` paths return `Deprecation`, `Sunset`, and `Link` headers |
| 2026-07-01 | **Sunset date** — legacy `/api/*` paths will return `410 Gone` |

## What is changing?

All API endpoints are moving from:

```
/api/{resource}
```

to:

```
/api/v1/{resource}
```

The only exception is `/api/auth/*`, which remains unversioned.

## Deprecation Headers

### RFC 8594 Compliant Headers

Clients hitting legacy `/api/*` paths will receive these standard HTTP headers:

| Header | Value | Standard | Purpose |
|--------|-------|----------|---------|
| `Deprecation` | `true` | RFC 8594 | Indicates this resource is deprecated |
| `Sunset` | `Wed, 01 Jul 2026 00:00:00 GMT` | RFC 8594 | Date after which resource is no longer available |
| `Link` | `<docs/api-migration-v1.md>; rel="deprecation"` | RFC 5988 | Reference to migration documentation |

### Custom Guidance Headers

Additional headers to help with migration:

| Header | Example Value | Purpose |
|--------|------|---------|
| `X-API-Warn` | `deprecated; sunset="Wed, 01 Jul 2026 00:00:00 GMT"; docs="/docs/api-migration-v1.md"` | Machine-readable deprecation metadata |
| `X-API-Suggest` | `Use /api/v1/portfolios instead` | Concise migration suggestion |

### Example Response Headers

```http
GET /api/portfolios HTTP/1.1
Host: api.example.com

HTTP/1.1 200 OK
Deprecation: true
Sunset: Wed, 01 Jul 2026 00:00:00 GMT
Link: </docs/api-migration-v1.md>; rel="deprecation"
X-API-Warn: deprecated; sunset="Wed, 01 Jul 2026 00:00:00 GMT"; docs="/docs/api-migration-v1.md"
X-API-Suggest: Use /api/v1/portfolios instead
Content-Type: application/json

{
  "portfolios": [...]
}
```

## Deprecation in Response Bodies

### Opt-in Response Body Deprecation Info

For error responses or when explicitly requested, deprecation metadata is included in the JSON response body:

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Your portfolio allocation is invalid"
  },
  "deprecation": {
    "deprecated": true,
    "sunset": "Wed, 01 Jul 2026 00:00:00 GMT",
    "sunsetDate": "2026-07-01T00:00:00Z",
    "sunsetSeconds": 15778463,
    "migrationGuide": "/docs/api-migration-v1.md",
    "suggestedAlternative": "/api/v1/portfolios",
    "lastSunsetWarning": false,
    "message": "This endpoint is deprecated. Please use /api/v1/portfolios instead. See /docs/api-migration-v1.md"
  }
}
```

To include deprecation info in successful responses, pass the query parameter:
```
GET /api/portfolios?_includeDeprecation=true
```

## Server-Side Logging

The server logs all deprecated API usage for monitoring and analytics:

```
[DEPRECATION] path="/portfolios" method="GET" daysUntilSunset=180 suggestedAlternative="/api/v1/portfolios"
```

If less than 7 days remain before sunset, logs are elevated to WARN level:
```
[DEPRECATION] WARN: path="/portfolios" daysUntilSunset=3 isLastWeekWarning=true
```

## How to Migrate

### Step 1: Update base URL

Change your API client's base URL from:

```
https://your-api.example.com/api/
```

to:

```
https://your-api.example.com/api/v1/
```

### Step 2: Monitor for deprecation headers

Add client-side logic to detect deprecation headers:

```javascript
fetch('https://api.example.com/api/portfolios')
  .then(res => {
    if (res.headers.get('Deprecation') === 'true') {
      console.warn('This endpoint is deprecated');
      console.warn('Sunset:', res.headers.get('Sunset'));
      console.warn('Migrate to:', res.headers.get('X-API-Suggest'));
    }
    return res.json();
  });
```

Or for a more robust approach:

```typescript
interface DeprecatedResponse {
  deprecation?: {
    deprecated: boolean;
    sunset: string;
    suggestedAlternative: string;
    migrationGuide: string;
    message: string;
  };
}

async function fetchWithDeprecationWarning<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { '_includeDeprecation': 'true' } });
  const data = await res.json() as DeprecatedResponse;
  
  if (data.deprecation) {
    logger.warn('Using deprecated API endpoint', {
      endpoint: url,
      sunset: data.deprecation.sunset,
      alternative: data.deprecation.suggestedAlternative
    });
  }
  
  return data as T;
}
```

### Step 3: Verify no deprecation headers

After migrating, responses should **not** include `Deprecation`, `Sunset`, `X-API-Warn`, or `X-API-Suggest` headers. If you see these headers, you are still hitting the legacy path.

### Step 4: Test your integration

Run your existing test suite against the `/api/v1/*` namespace. All endpoints maintain backward compatibility in their request/response formats.

## Client-Side Best Practices

### React Example

```typescript
import { useEffect, useState } from 'react';

interface ApiEndpoint {
  url: string;
  isDeprecated: boolean;
}

function useApiEndpoint(legacyUrl: string): ApiEndpoint {
  const [deprecation, setDeprecation] = useState<{ deprecated: boolean }>({ deprecated: false });

  useEffect(() => {
    fetch(legacyUrl)
      .then(res => {
        setDeprecation({ 
          deprecated: res.headers.get('Deprecation') === 'true' 
        });
      })
      .catch(() => {});
  }, [legacyUrl]);

  return {
    url: deprecation.deprecated 
      ? legacyUrl.replace('/api/', '/api/v1/') 
      : legacyUrl,
    isDeprecated: deprecation.deprecated
  };
}

export function PortfolioWidget() {
  const endpoint = useApiEndpoint('/api/portfolios');
  
  if (endpoint.isDeprecated) {
    console.warn('Update API endpoint:', endpoint.url);
  }

  // ... rest of component
}
```

## What stays the same

- Request and response formats are identical between `/api/*` and `/api/v1/*`
- Authentication mechanisms are unchanged
- Idempotency key behavior is unchanged
- Rate limits are shared between namespaces
- Error handling and response codes are identical

## What happens after sunset (2026-07-01)?

After the sunset date, legacy `/api/*` paths will return HTTP `410 Gone`:

```http
HTTP/1.1 410 Gone
Content-Type: application/json

{
  "success": false,
  "error": {
    "code": "GONE",
    "message": "This API version has been sunset. Use /api/v1/ instead. See docs/api-migration-v1.md"
  }
}
```

## Header Parsing Reference

### For curl

```bash
# See deprecation headers
curl -i https://api.example.com/api/portfolios | grep -E '^(Deprecation|Sunset|Link|X-API)'

# Follow redirect and include headers
curl -i -L https://api.example.com/api/portfolios
```

### For Python requests

```python
import requests

res = requests.get('https://api.example.com/api/portfolios')

if res.headers.get('Deprecation') == 'true':
    print(f"Deprecated until: {res.headers.get('Sunset')}")
    print(f"Migrate to: {res.headers.get('X-API-Suggest')}")
```

### For Node.js

```javascript
const fetch = await import('node-fetch');

const res = await fetch('https://api.example.com/api/portfolios');

if (res.headers.get('deprecation') === 'true') {
  console.log(`Sunset: ${res.headers.get('sunset')}`);
  console.log(`Suggestion: ${res.headers.get('x-api-suggest')}`);
}
```

## Questions?

Open an issue on the repository or contact the maintainers.
