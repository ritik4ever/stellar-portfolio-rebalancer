# Security Audit: Idempotency Key Handling

## Issue: #1522 — Threat-Model Idempotency Key Handling

### Date: 2026-07-27
### Category: Security (Backend)
### Area: `backend/src/services/idempotencyRedisStore.ts`

---

## Summary

Idempotency keys were stored globally without user scoping in both Redis and SQLite, creating cross-user collision and cache-poisoning risks. This has been remediated by scoping idempotency keys to the authenticated user in all storage layers.

---

## Findings

### F1: Idempotency Keys Not Scoped to User (HIGH)

**File:** `backend/src/middleware/idempotency.ts`  
**Storage:** `backend/src/services/idempotencyRedisStore.ts`, `backend/src/db/idempotencyDb.ts`

**Description:**  
Idempotency keys were stored using a global namespace (`idempotency:${key}` in Redis, `key` as PRIMARY KEY in SQLite). The idempotency key value provided by the client was the sole lookup key, with no association to the authenticated user. This meant any user could reuse or guess another user's idempotency key.

**Risk:**  
- **Cross-user key collision:** Two users using the same idempotency key value would interfere with each other's cached responses.  
- **Cache probing:** A malicious client could iterate through idempotency key values to attempt retrieval of other users' cached responses.  
- **Request forgery:** A user could submit a known idempotency key (originally used by another user for a different request) and, depending on timing and payload differences, cause a 409 Conflict or receive a stale response belonging to another user.

**Severity:** HIGH — enables cross-user data leakage and request interference.

**Remediation:**  
Idempotency keys are now scoped to the authenticated user by prefixing the storage key with the user identity (`${requestUser}:${key}`). This ensures:
- Each user's idempotency key namespace is isolated
- Cross-user key collisions are impossible at the storage layer
- A malicious client cannot probe or access another user's cached responses using idempotency keys

**Applied in:** `backend/src/middleware/idempotency.ts` — scoped key computation at line 29.

### F2: Idempotency Key Predictability (MEDIUM)

**File:** `backend/src/middleware/idempotency.ts`

**Description:**  
Idempotency keys are client-provided via the `Idempotency-Key` header. The server does not generate or validate the entropy/format of these keys. If a client uses predictable keys (e.g., sequential IDs, timestamps), a malicious actor could feasibly guess other users' keys.

**Risk:**  
Medium — mitigated by F1 (user scoping), but predictable keys remain a concern for users sharing the same key-namespace accidentally.

**Remediation:**  
- User scoping (F1) reduces this risk significantly since each user's keyspace is isolated.  
- **Recommendation:** Consider generating high-entropy idempotency keys server-side (e.g., UUID v4) for endpoints that handle sensitive operations, and deprecate client-provided keys for those endpoints.

---

## Remediation Status

| Finding | Severity | Status | PR |
|---------|----------|--------|----|
| F1: Cross-user key collision | HIGH | Remediated — keys now scoped to user | #1522 |
| F2: Key predictability | MEDIUM | Mitigated by F1; server-side key generation recommended | Future |

---

## Changes Made

1. **`backend/src/middleware/idempotency.ts`**: Added `scopedKey` computation (`${requestUser}:${key}`) and used it for all Redis and DB storage/lookup operations. Raw `key` is still used in response headers and logging.

2. **`backend/src/test/idempotency.test.ts`**:
   - Updated cross-user test from "rejects same idempotency key when replayed by a different user" to "allows same idempotency key value for different users" (correct behavior with user scoping).
   - Updated DB lookup assertions to use scoped keys where middleware-scope storage is involved.
   - Updated expiry/cleanup test to store with scoped key prefix.
