# Recovering when a wallet extension does not appear

Wallet extensions inject themselves into the page after it loads, can be installed or enabled while the app is open, and can be locked or removed later. `WalletSelector` therefore does not treat the first detection as final.

| Situation | Behaviour |
| --- | --- |
| No wallet at mount | The empty state explains that an installed extension must be enabled and unlocked, says reloading is not needed, and offers a **Check again** button |
| Extension injects late | The selector re-checks every 500 ms for the first 5 s and stops as soon as a wallet is found |
| User installs or unlocks it in another tab or window | Returning to this window (focus event) re-checks while no wallet is listed |
| **Check again**, nothing found | A polite status says "Still no wallet found…" with what to check; focus stays on the button |
| **Check again** / auto re-check, wallet found | The wallet buttons appear and a polite status announces "*Name* detected. Select a wallet to connect." |
| Extension disappears between listing and connecting | The error says the wallet is not available and how to fix it (install, enable, unlock, no reload), and the list is refreshed so a stale button is not left behind |

## What recovery never does

- It never reloads the page, so unrelated state the user has open (form edits, a rebalance in progress) is kept.
- Detection is idempotent and never calls `connect`, so retrying cannot start a second wallet request or duplicate an action. The existing guard still allows only one connect request at a time.
- A late detection moves focus to the first wallet only if focus was already inside the selector (for example on **Check again**); otherwise focus stays where the user is, so typing elsewhere is not interrupted.

Tests: `WalletSelector.recovery.test.tsx`. See also `WALLET_ACTION_ANNOUNCEMENTS.md` and `DISCONNECTED_WALLET_BEHAVIOR.md`.
