# Security Audit: debug.routes.ts Exposure Risk

**Audit Date:** 2026-07-27  
**Issue:** [#1521](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1521)  
**Component:** `backend/src/api/debug.routes.ts`  
**Severity:** Medium-High

---

## 1. Summary

The `debug.routes.ts` module exposes 6 debug endpoints under `/api/debug/*` and `/api/v1/debug/*`. All routes are gated by the `blockDebugInProduction` middleware which checks the `ENABLE_DEBUG_ROUTES` feature flag (default: `false`). Only one of the six routes also requires admin authentication (`requireAdmin`).

If the feature flag is accidentally enabled in production — or if the gating middleware is misconfigured — five of the six routes are accessible without any additional authentication, exposing internal state, secrets metadata, and unsafe actions.

---

## 2. Current Defense Layers

### Layer 1: Feature Flag Gate (`blockDebugInProduction`)
- **File:** `backend/src/middleware/debugGate.ts`
- **Mechanism:** Checks `getFeatureFlags().enableDebugRoutes` (env var `ENABLE_DEBUG_ROUTES`)
- **Default:** `false` in all environments (explicitly set in `featureFlags.ts:91`)
- **Override:** Can be enabled via `ENABLE_DEBUG_ROUTES=true` env var or a JSON feature-flag override file
- **Effect when blocked:** Returns HTTP 404 "Not Found" (does not reveal that a debug route exists)

### Layer 2: Admin Auth (`requireAdmin`)
- **File:** `backend/src/middleware/auth.ts`
- **Mechanism:** Stellar keypair signature verification (`X-Public-Key`, `X-Message`, `X-Signature` headers)
- **Applied to:** Only `POST /debug/notifications/test`
- **Missing from:** All 5 GET endpoints

### Layer 3: Rate Limiting
- **File:** `backend/src/middleware/rateLimit.ts`
- **Status:** Global `dynamicRateLimiter` is applied at the app level in `mountApiRoutes.ts`, so debug routes are implicitly rate-limited — but there is no per-route tightening.

---

## 3. Route-by-Route Assessment

### 3.1 `POST /debug/notifications/test`
| Field | Value |
|-------|-------|
| **Auth** | `requireAdmin` + `blockDebugInProduction` |
| **Severity** | Low |
| **Risk** | Sends a test notification to a user. Guarded by two layers. Admin auth prevents unauthorized use. |

### 3.2 `GET /debug/coingecko-test`
| Field | Value |
|-------|-------|
| **Auth** | `blockDebugInProduction` only |
| **Severity** | **High** |
| **Risk** | Proxies a request to CoinGecko API. Leaks whether `COINGECKO_API_KEY` is set. Returns the API test URL (pro/ free) and full response data. Could be abused as an open relay/proxy for CoinGecko API. |
| **Disclosure** | `apiKeySet: boolean` |

### 3.3 `GET /debug/force-fresh-prices`
| Field | Value |
|-------|-------|
| **Auth** | `blockDebugInProduction` only |
| **Severity** | **High** |
| **Risk** | Clears the price cache and forces a fresh fetch from CoinGecko. Unauthenticated callers can trigger cache thrashing (DoS vector), causing excessive API calls, rate-limit consumption, and degraded performance for legitimate users. |
| **Disclosure** | Returns full price data and cache status. |

### 3.4 `GET /debug/reflector-test`
| Field | Value |
|-------|-------|
| **Auth** | `blockDebugInProduction` only |
| **Severity** | **High** |
| **Risk** | Tests Reflector API connectivity and returns cache internals. **Leaks `COINGECKO_API_KEY` length**, which is unnecessary information and aids brute-force/bisection attacks on the key. |
| **Disclosure** | `apiKeySet: boolean`, `apiKeyLength: number`, connectivity test results, cache status |

### 3.5 `GET /debug/env`
| Field | Value |
|-------|-------|
| **Auth** | `blockDebugInProduction` only |
| **Severity** | **Medium** |
| **Risk** | Leaks runtime environment configuration: `NODE_ENV`, `PORT`, `ENABLE_AUTO_REBALANCER`, whether auto-rebalancer is running, and whether `COINGECKO_API_KEY` is set. Useful reconnaissance target. |
| **Disclosure** | `autoRebalancerEnabled`, `autoRebalancerRunning`, `enableAutoRebalancer`, `port`, `nodeEnv`, `apiKeySet` |

### 3.6 `GET /debug/auto-rebalancer-test`
| Field | Value |
|-------|-------|
| **Auth** | `blockDebugInProduction` only |
| **Severity** | **Medium** |
| **Risk** | Returns auto-rebalancer status, statistics, and total portfolio count. Exposes operational metrics that aid reconnaissance. |
| **Disclosure** | `status`, `statistics`, `portfolioCount` |

---

## 4. Defense-in-Depth Analysis

| Layer | Status | Notes |
|-------|--------|-------|
| Feature flag gating | ✅ | Defaults to `false`; requires explicit opt-in |
| Admin auth on all debug routes | ❌ | Only 1/6 routes have it |
| IP allowlisting | ❌ | Not implemented |
| Per-route rate limiting | ❌ | Only global rate limiter applies |
| Audit logging | ✅ | All routes log via `logger` |
| Error messages | ⚠️ | Some errors include stack traces (`debug.routes.ts:86`) |

---

## 5. Recommended Hardening

### Critical (must fix)
1. **Add `requireAdmin` to all GET debug routes** — Every debug endpoint should require admin authentication, not just the POST route. This ensures that even if the feature flag is mistakenly enabled, routes remain authenticated.
2. **Remove `apiKeyLength` from `/debug/reflector-test` response** — Leaking the key length is unnecessary and aids cryptographic key attacks.

### High (strongly recommended)
3. **IP allowlisting** — Restrict debug routes to a set of trusted IP addresses (e.g., internal network, VPN) via a middleware or reverse proxy configuration.
4. **Tighten rate limiting** — Apply stricter per-route rate limits to `/debug/force-fresh-prices` and `/debug/coingecko-test` to prevent abuse.

### Medium (recommended)
5. **Remove `stack` from error responses** — Line 86 includes `error.stack` in the error response body, which leaks internal code paths.
6. **Remove `testUrl` from `/debug/coingecko-test` response** — The full URL is already logged server-side; returning it in the response is unnecessary.
7. **Reduce info leakage from `/debug/env`** — Omit `apiKeySet` (admin already knows if the key is configured) and `port` (reconnaissance target).

---

## 6. Cross-Reference with Feature-Flag Gating

The `ENABLE_DEBUG_ROUTES` feature flag (tracked separately) is the primary gate. The flag:
- Defaults to `false` — safe-by-default
- Can be enabled via `ENABLE_DEBUG_ROUTES=true` env var
- Can be enabled via a JSON feature-flag override file (`FEATURE_FLAGS_FILE`)
- Is logged during startup in `featureFlags.ts`

**Assessment:** The flag gating alone is **insufficient** defense for the 5 unauthenticated GET routes. If the flag is accidentally enabled (e.g., typo in override file, environment variable leak, or deployment pipeline misconfiguration), all five routes become publicly accessible. Admin authentication on each route provides essential defense-in-depth.

---

## 7. Remediation Status

| Finding | Severity | Status |
|---------|----------|--------|
| Missing admin auth on GET `/debug/coingecko-test` | High | **Fixed** — `requireAdmin` added |
| Missing admin auth on GET `/debug/force-fresh-prices` | High | **Fixed** — `requireAdmin` added |
| Missing admin auth on GET `/debug/reflector-test` | High | **Fixed** — `requireAdmin` added |
| Missing admin auth on GET `/debug/env` | Medium | **Fixed** — `requireAdmin` added |
| Missing admin auth on GET `/debug/auto-rebalancer-test` | Medium | **Fixed** — `requireAdmin` added |
| `apiKeyLength` leaked in `/debug/reflector-test` | High | **Fixed** — field removed |
| Stack traces in error responses | Medium | **Fixed** — removed from `/debug/coingecko-test` |
| `testUrl` leaked in `/debug/coingecko-test` | Low | **Fixed** — field removed |
| `apiKeySet` + `port` + `enableAutoRebalancer` leaked in `/debug/env` | Medium | **Fixed** — reduced to essential fields |
| No IP allowlisting | Medium | Open — recommend reverse proxy configuration |
| No per-route rate limiting | Low | Open — partially mitigated by global rate limiter |
