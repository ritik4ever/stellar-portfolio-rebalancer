# Feature: Telegram Bot /status Command

## Overview
This PR implements the Telegram bot `/status` command for on-demand portfolio status reporting.

## Implementation

### Files Modified/Added:
- `backend/src/notifications/telegramBot.ts` - Added /status command handler
- `backend/src/notifications/telegramCommands.ts` - Implemented status command logic
- `backend/src/notifications/telegramLink.ts` - Added chat-to-account linking persistence

### Changes:

**telegramBot.ts:**
- Added `/status` text handler that calls `handleStatusCommand()`
- Returns formatted response with parse mode for Markdown
- Integrated with existing bot polling infrastructure

**telegramCommands.ts:**
- Implemented `handleStatusCommand()` function
- Added `LINK_INSTRUCTIONS` constant for unlinked accounts
- Added `computeMaxDrift()` helper for portfolio drift calculation
- Added `formatPortfolio()` helper for portfolio status formatting
- Added `formatLastRebalance()` helper for timestamp formatting
- Handles unlinked chats with clear linking instructions
- Fetches user portfolios via `portfolioStorage.getUserPortfolios()`
- Returns allocation, drift, and last rebalance time for each portfolio

**telegramLink.ts:**
- Implemented `linkChat()` to associate chat ID with user address
- Implemented `unlinkChat()` to remove association
- Implemented `getLinkedAddress()` to retrieve linked user
- Uses KV store for persistence
- Added `resetTelegramLinksForTests()` for test isolation

## Acceptance Criteria Met:
- ✅ Users can request current portfolio status on demand via the Telegram bot
- ✅ Unlinked accounts receive clear instructions rather than an error
- ✅ Test confirms correct response formatting for a linked user with active portfolios

## Tests
Added comprehensive test coverage in `backend/src/test/telegramStatusCommand.test.ts`:
- Tests for unlinked chats receiving linking instructions
- Tests for linked chats showing portfolio status
- Tests for drift calculation
- Tests for link persistence
- Tests for error handling

## Environment Variables Required:
```
TELEGRAM_BOT_TOKEN=your_bot_token
```

Closes #1190
