# Telegram Bot

Set `TELEGRAM_BOT_TOKEN` to start the bot in polling mode.

## Commands

| Command | Description |
| --- | --- |
| `/link <address>` | Link this chat to a Stellar address |
| `/status` | On-demand status for the linked account's portfolios (#1396) |
| `/unlink` | Remove the link |
| `/pause` | Pause automatic rebalancing |
| `/resume` | Resume automatic rebalancing |
| `/start` | Command list |

## `/status`

Reports on the **requesting chat's linked portfolios** rather than global
totals. For each portfolio it returns:

- current vs target allocation per asset
- max drift against the portfolio's threshold, flagged when a rebalance is due
- last rebalance time (or `never`)

An **unlinked chat gets linking instructions**, not an error — a new user is told
what to do rather than hitting a dead end. A linked account with no portfolios
gets a short "create one in the web app" message.

If the portfolio lookup fails, the reply is a generic retry message; the
underlying error goes to the logs rather than into the chat.

## Linking

Chat → address mappings live in the `kv_store` table under `telegram:link:<chatId>`,
mirrored in memory, so a link survives a restart. `telegramLink.ts` owns that
mapping; `telegramCommands.ts` owns the command handlers and is deliberately free
of the bot transport so handlers can be driven directly from a mocked update
payload in tests.
