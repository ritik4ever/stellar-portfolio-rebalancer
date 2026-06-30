# Security Audit — Manual Pentest Checklist

This checklist must be completed and signed off by a reviewer **before any mainnet deployment**.
Each item should be marked ✅ (pass), ❌ (fail / finding logged), or N/A with a brief note.

---

## Prerequisites

| Item | Status | Notes |
|------|--------|-------|
| Staging environment deployed and accessible | | |
| ZAP passive scan passed (no HIGH findings) | | See CI artifact `zap-report` |
| `npm audit` baseline clean or all exceptions acknowledged | | `security/npm-audit-baseline.json` |
| Reviewer name & date recorded below | | |

**Reviewer:** ___________________________  **Date:** _______________

---

## 1. Authentication Bypass

Goal: confirm that every protected endpoint and page rejects unauthenticated / incorrectly-authenticated requests.

| # | Test | Expected | Status | Notes |
|---|------|----------|--------|-------|
| 1.1 | Access `/api/portfolios` with no `Authorization` header | 401 Unauthorized | | |
| 1.2 | Access `/api/portfolios` with a malformed token (`Authorization: Bearer garbage`) | 401 Unauthorized | | |
| 1.3 | Access `/api/portfolios` with an expired token (modify `exp` claim in payload, re-encode without re-signing) | 401 Unauthorized | | |
| 1.4 | Access `/api/portfolios` with a token signed with a different secret (`HS256` brute-force / `alg: none` attack) | 401 Unauthorized | | |
| 1.5 | Delete `Authorization` cookie/header mid-session and replay a subsequent request | 401 Unauthorized | | |
| 1.6 | Attempt to reach any authenticated frontend route (`/dashboard`, `/rebalance`) without a valid session | Redirect to login | | |
| 1.7 | CORS preflight: confirm `Access-Control-Allow-Origin` does not echo arbitrary origin | Only allowlisted origins | | |

---

## 2. JWT Forgery

Goal: confirm the API cannot be tricked into accepting attacker-crafted tokens.

| # | Test | Expected | Status | Notes |
|---|------|----------|--------|-------|
| 2.1 | **`alg: none` attack** — strip signature, set `"alg":"none"` in header | 401 Unauthorized | | |
| 2.2 | **Algorithm confusion (`RS256 → HS256`)** — if any asymmetric key path exists, sign with public key as HMAC secret | 401 Unauthorized | | |
| 2.3 | **`kid` header injection** — set `kid` to a SQL fragment or file path (`../../etc/passwd`) | 401 / no SSRF or SQLi | | |
| 2.4 | **Claim tampering** — take a valid token, change `sub`/`userId` to another user's ID, re-encode (keep original signature) | 401 Unauthorized | | |
| 2.5 | **Token reuse after logout** — log out, then replay the old token against a protected endpoint | 401 Unauthorized | | |
| 2.6 | Confirm `exp` and `iat` claims are present and validated server-side | Token without `exp` rejected | | |
| 2.7 | Confirm the server rejects tokens with `nbf` in the future | 401 Unauthorized | | |

---

## 3. Insecure Direct Object Reference (IDOR)

Goal: confirm users cannot read, modify, or delete resources belonging to other users.

| # | Test | Expected | Status | Notes |
|---|------|----------|--------|-------|
| 3.1 | `GET /api/portfolios/:id` — use User A's token to fetch User B's portfolio ID | 403 or 404 | | |
| 3.2 | `PUT /api/portfolios/:id` — use User A's token to update User B's portfolio | 403 or 404 | | |
| 3.3 | `DELETE /api/portfolios/:id` — use User A's token to delete User B's portfolio | 403 or 404 | | |
| 3.4 | `GET /api/portfolios/:id/rebalance-history` — cross-user read of transaction history | 403 or 404 | | |
| 3.5 | Enumerate sequential IDs (`/api/portfolios/1`, `/2`, `/3` …) to discover other users' resources | No disclosure | | |
| 3.6 | IDOR via query parameter — `?userId=<other>` or `?ownerId=<other>` appended to any endpoint | Parameter ignored or 403 | | |
| 3.7 | Wallet address as identifier — confirm wallet address of User B cannot be used to pull User B's data via User A's session | 403 or 404 | | |

---

## 4. Rate Limit Bypass

Goal: confirm the API enforces rate limits and that common bypass techniques are ineffective.

| # | Test | Expected | Status | Notes |
|---|------|----------|--------|-------|
| 4.1 | Send >100 requests/minute to `/api/auth/login` from a single IP | 429 Too Many Requests after threshold | | |
| 4.2 | Rotate `X-Forwarded-For` header values to spoof different IPs on each request | Rate limit still enforced (server-side IP, not header) | | |
| 4.3 | Rotate `X-Real-IP` header values (same as above) | Rate limit still enforced | | |
| 4.4 | Vary `User-Agent` header on every request | Rate limit still enforced | | |
| 4.5 | Authenticated endpoint burst — send >200 requests/minute to `/api/portfolios` with a valid token | 429 after threshold | | |
| 4.6 | POST `/api/portfolios/:id/rebalance` rapid-fire — trigger >10 rebalance jobs in 60 seconds | 429 or idempotency guard | | |
| 4.7 | Confirm `Retry-After` header is present in 429 responses | `Retry-After` header set | | |
| 4.8 | Distributed burst — 10 different accounts each at 90% of limit simultaneously | Global rate limit or per-account limit holds | | |

---

## 5. Additional Checks (Pre-Mainnet)

| # | Test | Expected | Status | Notes |
|---|------|----------|--------|-------|
| 5.1 | **SQL injection** — inject `' OR '1'='1` into portfolio name / search fields | Input sanitised, no data leak | | |
| 5.2 | **Mass assignment** — POST body includes `role: "admin"` or `isAdmin: true` | Extra fields ignored | | |
| 5.3 | **Sensitive data exposure** — confirm `JWT_SECRET`, `DATABASE_URL`, private keys absent from API responses and logs | No secrets in responses | | |
| 5.4 | **HTTPS enforcement** — HTTP requests redirect to HTTPS on staging | 301/302 → HTTPS | | |
| 5.5 | **Security headers** — check `Strict-Transport-Security`, `X-Content-Type-Options`, `Content-Security-Policy` present | Headers present | | |
| 5.6 | **Stellar contract — rebalance threshold bypass** — submit a transaction that skips the threshold check | Contract rejects tx | | |
| 5.7 | **Error message leakage** — trigger 500 errors; confirm stack traces not returned to client | Generic error message | | |

---

## Sign-Off

All HIGH and CRITICAL items above must be ✅ before mainnet deployment.
Open MEDIUM findings must have a logged issue with a target fix date.

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Security Reviewer | | | |
| Lead Engineer | | | |
| Project Lead | | | |
