# Feature Implementation: Notification & Analytics Enhancements

This PR implements four backend features for the stellar-portfolio-rebalancer project:

- **Per-portfolio notification preference overrides** (#1189)
- **SMS notification channel with Twilio** (#1186)
- **Configurable retention policy for analytics compaction** (#1191)
- **Telegram bot /status command** (#1190)

## Changes Summary

### Task #1189: Per-Portfolio Notification Preference Overrides

**Implementation Location:** `backend/src/services/notificationPreferences.ts`, `backend/src/api/preferences.routes.ts`, `backend/src/services/notificationService.ts`

**Changes:**
- Extended notification preferences schema to support per-portfolio overrides layered on top of global user preferences
- Added `portfolioNotificationOverrideSchema` for partial preference overrides
- Implemented `resolvePortfolioNotificationPreferences()` function to check portfolio-level overrides before falling back to global settings
- Added API endpoints in `preferences.routes.ts`:
  - `GET /api/preferences/notifications/portfolio/:portfolioId` - Get override and resolved preferences
  - `GET /api/preferences/notifications/portfolio` - List all user's portfolio overrides
  - `PUT /api/preferences/notifications/portfolio/:portfolioId` - Set portfolio override
  - `DELETE /api/preferences/notifications/portfolio/:portfolioId` - Remove override
- Added service methods in `notificationService.ts`:
  - `getPreferencesForPortfolio()` - Resolve preferences with override layering
  - `setPortfolioOverride()` - Create/update override
  - `getPortfolioOverride()` - Retrieve override
  - `listPortfolioOverrides()` - List all user overrides
  - `deletePortfolioOverride()` - Remove override

**Tests:** `backend/src/test/portfolioNotificationOverrides.test.ts` - Covers override-present and fallback-to-global resolution paths

**Acceptance Criteria Met:**
- ✅ Users can set notification preferences that apply to a single portfolio, overriding global defaults
- ✅ Preference resolution correctly falls back to global settings when no override exists
- ✅ Tests cover both override and fallback paths

---

### Task #1186: SMS Notification Channel (Twilio)

**Implementation Location:** `backend/src/notifications/sms.ts`, `backend/src/services/notificationService.ts`, `backend/src/services/notificationDelivery.ts`

**Changes:**
- Created `sms.ts` integrating Twilio SDK for outbound SMS alerts
- Implemented phone number verification flow:
  - `generateVerificationCode()` - 6-digit random code
  - `hashVerificationCode()` - SHA-256 hash for secure storage
  - `verifyCodeHash()` - Timing-safe comparison
  - `normalizePhoneNumber()` - E.164 format validation
- Added `SmsProvider` class in `notificationService.ts` with:
  - Phone number verification requirement
  - Rate limiting (5 SMS/hour per user)
  - Critical event filtering (circuitBreaker, riskChange, correlation_breakdown only)
- Registered SMS channel in `notificationDelivery.ts` with appropriate rate limiting
- Added verification endpoints in notification service:
  - `requestSmsVerification()` - Send verification code via SMS
  - `confirmSmsVerification()` - Verify code and enable SMS

**Tests:** `backend/src/test/slackSmsNotifications.test.ts` - Mocks Twilio client, asserts message content and delivery-failure handling

**Acceptance Criteria Met:**
- ✅ Users can verify a phone number and receive critical alerts via SMS
- ✅ Unverified numbers cannot receive SMS notifications
- ✅ Tests cover successful send, verification flow, and provider-failure handling

---

### Task #1191: Configurable Retention Policy for Analytics Compaction

**Implementation Location:** `backend/src/config/analyticsCompactionConfig.ts`, `backend/src/queue/workers/analyticsCompactionWorker.ts`

**Changes:**
- Added configurable retention window via environment variables:
  - `ANALYTICS_COMPACTION_CUTOFF_DAYS` (default: 90) - Days of raw data to keep before compaction
  - `ANALYTICS_COMPACTION_RECENT_DAYS` (default: 7) - Recent days of raw snapshots to retain before daily rollup
- Added validation with min/max bounds:
  - Cutoff days: 1-3650 (10 years)
  - Recent days: 1-365 (1 year)
- Supports legacy environment variable aliases for backward compatibility
- Updated `analyticsCompactionWorker.ts` to use config from `getAnalyticsCompactionConfig()`
- Compaction respects configured window when aggregating and pruning raw analytics records

**Tests:** `backend/src/test/analyticsCompactionConfig.test.ts` - Covers different retention window values and boundary verification

**Acceptance Criteria Met:**
- ✅ Retention window is configurable without code changes (via environment variables)
- ✅ Compaction correctly prunes data older than the configured window
- ✅ Tests verify boundary behavior for multiple retention settings

---

### Task #1190: Telegram Bot Command for On-Demand Portfolio Status

**Implementation Location:** `backend/src/notifications/telegramBot.ts`, `backend/src/notifications/telegramCommands.ts`, `backend/src/notifications/telegramLink.ts`

**Changes:**
- Added `/status` command handler in `telegramBot.ts` that looks up the requesting user's linked portfolios
- Implemented `handleStatusCommand()` in `telegramCommands.ts`:
  - Retrieves linked user address from chat ID
  - Fetches user's portfolios via `portfolioStorage.getUserPortfolios()`
  - Formats response with allocation, drift, and last rebalance time for each portfolio
  - Computes max drift as largest absolute gap between target and current allocation
- Added `LINK_INSTRUCTIONS` constant for unlinked accounts
- Implemented link persistence via `telegramLink.ts` using KV store
- Handles unauthenticated/unlinked Telegram accounts with clear linking instructions

**Tests:** `backend/src/test/telegramStatusCommand.test.ts` - Mocks Telegram update payload for /status command

**Acceptance Criteria Met:**
- ✅ Users can request current portfolio status on demand via the Telegram bot
- ✅ Unlinked accounts receive clear instructions rather than an error
- ✅ Test confirms correct response formatting for a linked user with active portfolios

---

## Testing

All features include comprehensive test coverage:

- **Portfolio Overrides:** 428 lines of tests covering resolution logic, service layer, and HTTP endpoints
- **SMS Notifications:** Tests for Twilio client mocking, verification hashes, and provider failures
- **Analytics Compaction Config:** 140 lines of tests for parsing, validation, and boundary conditions
- **Telegram Status Command:** 250 lines of tests for linked/unlinked chats, drift calculation, and error handling

## Environment Variables Required

For SMS notifications:
```
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+15550001111
```

For analytics compaction (optional, with defaults):
```
ANALYTICS_COMPACTION_CUTOFF_DAYS=90
ANALYTICS_COMPACTION_RECENT_DAYS=7
```

For Telegram bot:
```
TELEGRAM_BOT_TOKEN=your_bot_token
```

## Close References

Closes #1189, #1186, #1191, #1190
