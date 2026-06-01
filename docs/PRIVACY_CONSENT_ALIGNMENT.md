# Privacy Policy Wording Alignment with Consent and Notification Flows

This guide ensures that privacy policy documentation, consent UI, and notification behavior are consistent and match what the product actually implements. Use this to audit legal wording, update policies, and maintain compliance.

## Quick Reference

| Component               | Location                                      | Responsibility       | Audit Frequency |
| ----------------------- | --------------------------------------------- | -------------------- | --------------- |
| **Privacy Policy**      | Legal pages (frontend)                        | Legal team + Product | Quarterly       |
| **Terms of Service**    | Legal pages (frontend)                        | Legal team + Product | Quarterly       |
| **Cookie Policy**       | Legal pages (frontend)                        | Legal team + Product | Quarterly       |
| **Consent Modal**       | `frontend/src/components/ConsentModal.tsx`    | Product + Frontend   | Per release     |
| **Notification System** | `backend/src/services/notificationService.ts` | Product + Backend    | Per release     |
| **Consent Routes**      | `backend/src/api/consent.routes.ts`           | Backend + Legal      | Per release     |
| **Environment Docs**    | `docs/ENVIRONMENT.md`                         | Backend + Ops        | Per release     |

---

## Consent Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Journey                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User visits app                                             │
│     ↓                                                           │
│  2. ConsentModal shown (if not previously accepted)            │
│     ├─ Terms of Service checkbox                               │
│     ├─ Privacy Policy checkbox                                 │
│     └─ Cookie Policy checkbox                                  │
│     ↓                                                           │
│  3. User clicks "Accept and continue"                          │
│     ↓                                                           │
│  4. Frontend calls POST /api/consent                           │
│     ├─ Sends: userId, terms, privacy, cookies (all true)      │
│     ├─ Idempotency-Key: prevents duplicate consent records    │
│     └─ IP address + User-Agent captured by backend            │
│     ↓                                                           │
│  5. Backend records consent in database                        │
│     ├─ Stores: userId, terms/privacy/cookies timestamps       │
│     ├─ Stores: IP address, User-Agent                         │
│     ├─ Creates immutable audit event                          │
│     └─ Emits: consent_granted event                           │
│     ↓                                                           │
│  6. User can now use app                                       │
│     ├─ Portfolio creation enabled                             │
│     ├─ Rebalancing enabled                                    │
│     └─ Notifications enabled (if subscribed)                  │
│     ↓                                                           │
│  7. User can revoke consent anytime                            │
│     ├─ DELETE /user/:address/data (GDPR right to be forgotten)│
│     ├─ POST /consent/revoke (revoke active consent)           │
│     └─ Backend creates immutable revocation event             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Consent Modal Wording

**File:** `frontend/src/components/ConsentModal.tsx`

### Current Implementation

```typescript
<label className="flex items-start gap-3 cursor-pointer">
    <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
    <span className="text-gray-700 dark:text-gray-300 text-sm">
        I accept the{' '}
        <button type="button" onClick={() => onOpenLegal('terms')} className="text-blue-600 hover:underline font-medium">
            Terms of Service
        </button>
        {' '}(disclaimers, liability, smart contract risks).
    </span>
</label>

<label className="flex items-start gap-3 cursor-pointer">
    <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
    <span className="text-gray-700 dark:text-gray-300 text-sm">
        I accept the{' '}
        <button type="button" onClick={() => onOpenLegal('privacy')} className="text-blue-600 hover:underline font-medium">
            Privacy Policy
        </button>
        {' '}(GDPR/CCPA compliant).
    </span>
</label>

<label className="flex items-start gap-3 cursor-pointer">
    <input type="checkbox" checked={cookies} onChange={(e) => setCookies(e.target.checked)} />
    <span className="text-gray-700 dark:text-gray-300 text-sm">
        I accept the{' '}
        <button type="button" onClick={() => onOpenLegal('cookies')} className="text-blue-600 hover:underline font-medium">
            Cookie Policy
        </button>.
    </span>
</label>
```

### Alignment Checklist

- [ ] **Terms of Service** mentions:
  - Smart contract risks and disclaimers
  - Liability limitations
  - User responsibility for private keys
  - No guarantee of rebalance execution
  - Slippage and gas fee risks

- [ ] **Privacy Policy** mentions:
  - Data collection: Stellar address, portfolio allocations, transaction history
  - Data usage: Portfolio analysis, rebalancing, analytics
  - Data retention: Kept until user deletion or account closure
  - GDPR/CCPA compliance: Right to access, right to deletion, right to portability
  - Third-party sharing: None (data not shared with external services)
  - Cookies: Session tokens, analytics (if enabled)

- [ ] **Cookie Policy** mentions:
  - Session cookies: JWT tokens for authentication
  - Analytics cookies: Portfolio performance tracking (optional)
  - No third-party tracking cookies
  - User can disable cookies in browser settings

---

## Notification System Wording

**File:** `docs/NOTIFICATIONS.md`

### Current Implementation

**Event types and descriptions:**

| Event                 | When Triggered                            | What User Receives                           | Data Shared                                     |
| --------------------- | ----------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| **Rebalance**         | Manual or automatic rebalance executed    | Email + webhook with trade details, gas used | Portfolio ID, trade count, gas cost             |
| **Circuit Breaker**   | High volatility or extreme price movement | Email + webhook with asset and price change  | Asset symbol, price change %, cooldown duration |
| **Price Movement**    | Asset price changes >10%                  | Email + webhook with price and direction     | Asset symbol, price change %, current price     |
| **Risk Level Change** | Portfolio risk level increases/decreases  | Email + webhook with old/new risk level      | Portfolio ID, risk level, severity              |

### Alignment Checklist

- [ ] **Notification preferences endpoint** (`POST /api/notifications/subscribe`):
  - Allows user to opt-in/out of each event type
  - Allows user to choose email and/or webhook
  - Stores preferences in database
  - Supports idempotent updates

- [ ] **Email notifications**:
  - Sent via SMTP (Gmail, SendGrid, Mailgun, AWS SES)
  - Include unsubscribe link
  - Include portfolio details
  - Include timestamp
  - Plain text + HTML formats

- [ ] **Webhook notifications**:
  - POST to user-provided URL
  - Include event type, title, message, data, timestamp, userId
  - Retry once after 1 second if fails
  - Timeout after 5 seconds
  - User responsible for webhook security

- [ ] **Rate limiting**:
  - Maximum 10 notifications per hour per user
  - Prevents spam and abuse
  - Documented in API reference

- [ ] **Data privacy**:
  - Email addresses stored securely
  - Webhook URLs validated before saving
  - User data not shared with third parties
  - Notifications only sent to opted-in users

---

## Consent Routes Implementation

**File:** `backend/src/api/consent.routes.ts`

### Endpoints and Behavior

#### GET /consent/status

**Purpose:** Check user's current consent status

**Response:**

```json
{
  "accepted": true,
  "termsAcceptedAt": "2025-01-15T10:30:00Z",
  "privacyAcceptedAt": "2025-01-15T10:30:00Z",
  "cookieAcceptedAt": "2025-01-15T10:30:00Z",
  "revokedAt": null,
  "active": true
}
```

**Alignment:**

- [ ] Returns all three consent types (terms, privacy, cookies)
- [ ] Shows acceptance timestamps
- [ ] Shows revocation timestamp if applicable
- [ ] Indicates if consent is currently active

#### POST /consent/grant

**Purpose:** Grant active consent (GDPR compliant)

**Request:**

```json
{
  "userId": "G...",
  "terms": true,
  "privacy": true,
  "cookies": true
}
```

**Behavior:**

- [ ] Requires all three consents to be true
- [ ] Creates immutable audit event
- [ ] Captures IP address and User-Agent
- [ ] Idempotent (same request returns same result)
- [ ] Rate-limited (write limiter)

#### POST /consent/revoke

**Purpose:** Revoke active consent (GDPR right to withdraw)

**Behavior:**

- [ ] Marks consent as revoked
- [ ] Creates immutable audit event
- [ ] Captures IP address and User-Agent
- [ ] User can no longer use app until re-consenting
- [ ] Rate-limited (critical limiter)

#### GET /consent/audit

**Purpose:** Return append-only audit trail (GDPR compliance)

**Response:**

```json
{
  "userId": "G...",
  "events": [
    {
      "type": "grant",
      "timestamp": "2025-01-15T10:30:00Z",
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0..."
    },
    {
      "type": "revoke",
      "timestamp": "2025-01-16T14:00:00Z",
      "ipAddress": "192.168.1.2",
      "userAgent": "Mozilla/5.0..."
    }
  ]
}
```

**Alignment:**

- [ ] Immutable audit trail (append-only)
- [ ] Includes timestamp, IP, User-Agent
- [ ] Shows grant and revoke events
- [ ] Accessible to user (GDPR right to access)

#### DELETE /user/:address/data

**Purpose:** GDPR right to be forgotten

**Behavior:**

- [ ] Deletes all user data: portfolios, history, consent, preferences
- [ ] Requires JWT authentication (user can only delete own data)
- [ ] Creates final audit event
- [ ] Irreversible (data cannot be recovered)
- [ ] Rate-limited (critical limiter)

**Alignment:**

- [ ] Implements GDPR Article 17 (right to erasure)
- [ ] Requires user authentication
- [ ] Deletes all personal data
- [ ] Provides audit trail of deletion

---

## Privacy Policy Audit Checklist

Use this checklist to ensure privacy policy matches implementation:

### Data Collection

- [ ] **Stellar Address**
  - Collected: Yes (required for portfolio creation)
  - Used for: Portfolio ownership, transaction signing
  - Retention: Until user deletion
  - Shared: No

- [ ] **Portfolio Allocations**
  - Collected: Yes (user provides)
  - Used for: Rebalancing calculations, analytics
  - Retention: Until user deletion
  - Shared: No

- [ ] **Transaction History**
  - Collected: Yes (from blockchain)
  - Used for: Rebalance history, analytics
  - Retention: Until user deletion
  - Shared: No

- [ ] **Email Address**
  - Collected: Optional (for notifications)
  - Used for: Email notifications only
  - Retention: Until user unsubscribes or deletion
  - Shared: No

- [ ] **Webhook URL**
  - Collected: Optional (for notifications)
  - Used for: Webhook notifications only
  - Retention: Until user unsubscribes or deletion
  - Shared: No

- [ ] **IP Address**
  - Collected: Yes (from HTTP requests)
  - Used for: Consent audit trail, security logging
  - Retention: 90 days (configurable)
  - Shared: No

- [ ] **User-Agent**
  - Collected: Yes (from HTTP requests)
  - Used for: Consent audit trail, debugging
  - Retention: 90 days (configurable)
  - Shared: No

### Data Usage

- [ ] **Portfolio Analysis**
  - Purpose: Calculate rebalance recommendations
  - Frequency: On-demand or scheduled
  - Retention: Until user deletion

- [ ] **Rebalancing**
  - Purpose: Execute trades on Stellar blockchain
  - Frequency: Manual or automatic
  - Retention: Transaction history kept indefinitely (blockchain immutable)

- [ ] **Analytics**
  - Purpose: Track portfolio performance, market trends
  - Frequency: Every 5 minutes (snapshots)
  - Retention: Last 1000 snapshots per portfolio

- [ ] **Notifications**
  - Purpose: Alert user to important events
  - Frequency: On-demand or scheduled
  - Retention: Notification logs kept for 30 days

### Data Retention

- [ ] **Active User Data**
  - Portfolios: Kept indefinitely
  - History: Kept indefinitely
  - Consent: Kept indefinitely
  - Preferences: Kept indefinitely

- [ ] **Deleted User Data**
  - All data deleted immediately upon user request
  - Blockchain transactions remain (immutable)
  - Audit trail of deletion kept for compliance

- [ ] **Inactive User Data**
  - No automatic deletion
  - User can request deletion anytime

### GDPR/CCPA Compliance

- [ ] **Right to Access**
  - Endpoint: `GET /consent/audit` (audit trail)
  - Endpoint: `GET /api/portfolio/:id` (portfolio data)
  - Endpoint: `GET /api/rebalance/history` (transaction history)
  - Response time: Within 30 days

- [ ] **Right to Deletion**
  - Endpoint: `DELETE /user/:address/data`
  - Scope: All personal data
  - Exceptions: Blockchain transactions (immutable)
  - Response time: Immediate

- [ ] **Right to Portability**
  - Endpoint: `GET /api/portfolio/:id/export` (if implemented)
  - Format: JSON or CSV
  - Response time: Within 30 days

- [ ] **Right to Withdraw Consent**
  - Endpoint: `POST /consent/revoke`
  - Effect: User cannot use app until re-consenting
  - Response time: Immediate

- [ ] **Data Processing Agreement**
  - Documented: Yes/No
  - Shared with users: Yes/No
  - Updated: Quarterly

### Third-Party Services

- [ ] **Email Provider**
  - Service: Gmail, SendGrid, Mailgun, AWS SES
  - Data shared: Email address, notification content
  - Privacy policy: User responsible for reviewing

- [ ] **Blockchain (Stellar)**
  - Service: Stellar network
  - Data shared: Stellar address, transaction details
  - Privacy policy: Stellar Foundation (public blockchain)

- [ ] **Analytics**
  - Service: None (internal only)
  - Data shared: None
  - Privacy policy: N/A

- [ ] **Monitoring**
  - Service: Sentry, New Relic (optional)
  - Data shared: Error logs, performance metrics
  - Privacy policy: User responsible for reviewing

---

## Consent history export (GDPR portability)

**Endpoint:** `GET /api/consent/export` (alias: `/api/v1/consent/export`)

Users with JWT authentication can download their own consent and revocation history. Supports `format=json` (default) or `format=csv`.

**Response (JSON)** includes:

- `exportedAt` — ISO timestamp of the export
- `deployedPolicyVersions` — current Terms / Privacy / Cookie document versions from server config
- `current` — latest consent snapshot with acceptance dates and stored `policyVersions`
- `history` — append-only grant/revoke events with `timestamp`, `action`, and `policyVersions`

Query `GET /api/consent/audit` returns the same events in a lighter shape; prefer `/consent/export` for portability downloads.

**Environment variables:** `LEGAL_TERMS_VERSION`, `LEGAL_PRIVACY_VERSION`, `LEGAL_COOKIE_VERSION` (default `1.0.0`).

---

## Notification Preferences Alignment

**File:** `backend/src/services/notificationService.ts`

### Subscription Endpoint

**Endpoint:** `POST /api/notifications/subscribe`

**Request:**

```json
{
  "userId": "G...",
  "emailEnabled": true,
  "emailAddress": "user@example.com",
  "webhookEnabled": true,
  "webhookUrl": "https://your-domain.com/webhook",
  "events": {
    "rebalance": true,
    "circuitBreaker": true,
    "priceMovement": true,
    "riskChange": true
  }
}
```

**Alignment Checklist:**

- [ ] User can opt-in/out of each event type
- [ ] User can choose email and/or webhook
- [ ] Email address validated before saving
- [ ] Webhook URL validated before saving
- [ ] Preferences stored in database
- [ ] Idempotent (same request returns same result)
- [ ] Rate-limited

### Unsubscribe Endpoint

**Endpoint:** `DELETE /api/notifications/unsubscribe`

**Behavior:**

- [ ] Disables all notifications for user
- [ ] Deletes email address and webhook URL
- [ ] Keeps preferences record for audit trail
- [ ] User can re-subscribe anytime

**Alignment:**

- [ ] Respects user's right to opt-out
- [ ] Complies with CAN-SPAM (email unsubscribe)
- [ ] Complies with GDPR (data deletion)

---

## Environment Variables and Privacy

**File:** `docs/ENVIRONMENT.md`

### Privacy-Related Variables

- [ ] **SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS**
  - Purpose: Email notification delivery
  - Sensitive: Yes (credentials)
  - Documented: Yes
  - Default: Gmail SMTP

- [ ] **NOTIFICATION_RATE_LIMIT_PER_HOUR**
  - Purpose: Prevent notification spam
  - Default: 10 notifications/hour
  - Documented: Yes

- [ ] **WEBHOOK_TIMEOUT, WEBHOOK_RETRY_COUNT, WEBHOOK_RETRY_DELAY**
  - Purpose: Webhook delivery reliability
  - Defaults: 5s timeout, 1 retry, 1s delay
  - Documented: Yes

- [ ] **JWT_SECRET, JWT_ACCESS_EXPIRY_SEC, JWT_REFRESH_EXPIRY_SEC**
  - Purpose: Authentication and session management
  - Sensitive: Yes (secret)
  - Documented: Yes

- [ ] **SENTRY_DSN, NEW_RELIC_LICENSE_KEY**
  - Purpose: Error tracking and monitoring
  - Sensitive: Yes (credentials)
  - Documented: Yes
  - Privacy note: User responsible for reviewing third-party privacy policies

---

## Audit Workflow

### Quarterly Privacy Audit

1. **Review Legal Documents**
   - [ ] Privacy Policy current and accurate
   - [ ] Terms of Service current and accurate
   - [ ] Cookie Policy current and accurate
   - [ ] All links working

2. **Review Consent Modal**
   - [ ] Wording matches legal documents
   - [ ] All three checkboxes present
   - [ ] Links to legal documents work
   - [ ] Modal appears on first visit

3. **Review Notification System**
   - [ ] Event types documented
   - [ ] Notification content matches policy
   - [ ] Opt-in/out working correctly
   - [ ] Rate limiting enforced

4. **Review Consent Routes**
   - [ ] All endpoints working
   - [ ] Audit trail immutable
   - [ ] GDPR endpoints implemented
   - [ ] Rate limiting enforced

5. **Review Data Handling**
   - [ ] Data collection matches policy
   - [ ] Data retention matches policy
   - [ ] Data deletion working correctly
   - [ ] Third-party services documented

6. **Document Findings**
   - [ ] Create audit report
   - [ ] List any discrepancies
   - [ ] Assign remediation tasks
   - [ ] Schedule follow-up

### Per-Release Privacy Checklist

Before each release:

- [ ] No new data collection without policy update
- [ ] No new third-party services without disclosure
- [ ] Consent modal wording unchanged (or updated with policy)
- [ ] Notification system behavior unchanged (or updated with policy)
- [ ] All GDPR endpoints still working
- [ ] Rate limiting still enforced
- [ ] Audit trail still immutable

---

## Related Documentation

- [Consent routes implementation](../backend/src/api/consent.routes.ts)
- [Notification system](../docs/NOTIFICATIONS.md)
- [Environment variables](../docs/ENVIRONMENT.md)
- [Operations handbook](../docs/OPERATIONS.md)

---

## Maintenance Notes

- **Update this guide** when privacy policy changes
- **Update consent modal** when legal documents change
- **Update notification system** when event types change
- **Test GDPR endpoints** in every release
- **Audit quarterly** to catch discrepancies early
- **Document all changes** in audit trail for compliance
