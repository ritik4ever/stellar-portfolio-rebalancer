# Wallet Connection & Signature Troubleshooting FAQ

This guide covers common issues encountered when connecting a Stellar wallet (Freighter, Rabet, xBull) to the Stellar Portfolio Rebalancer application.

---

## General Wallet Issues

### Q: My wallet extension is not detected by the app.

**Possible causes:**

- The wallet extension is not installed.
- The extension is installed but disabled or blocked.
- The browser privacy settings prevent the extension from injecting its API.

**Remedies:**

1. **Verify installation** — Check that the wallet extension (Freighter, Rabet, or xBull) is installed and visible in your browser's extension toolbar.
2. **Enable the extension** — If the icon is greyed out, click it and follow the prompts to enable it for the current site.
3. **Refresh the page** — After enabling, reload the application.
4. **Check permissions** — In Chrome/Edge, go to `chrome://extensions` and ensure the wallet extension has the required permissions (e.g., "On all sites" or the application's domain).
5. **Try a different browser** — Some extensions work better in Chromium-based browsers. Firefox support varies by wallet.

### Q: The wallet connects but the app shows "no address returned."

**Possible causes:**

- The wallet is locked and needs to be unlocked first.
- The wallet account was not created yet.
- A race condition between the connect and getAddress calls.

**Remedies:**

1. **Unlock your wallet** — Click the wallet extension icon and enter your password.
2. **Create an account** — If you are new, create a Stellar account through the wallet interface.
3. **Reconnect** — Disconnect and reconnect the wallet from the app. This triggers a fresh address read.
4. **Switch networks** — Ensure you are on the correct Stellar network (Mainnet or Testnet) as required by the application.

---

## Signature Failures

### Q: I see "Invalid signature" when trying to log in or perform an action.

**Possible causes:**

- The wallet signed with a different key than the one you are attempting to use.
- The signature challenge has expired.
- The network passphrase in the wallet does not match what the application expects.

**Remedies:**

1. **Use the same wallet** — Make sure you are signing with the wallet shown in the application. Switching wallets mid-flow will cause a signature mismatch.
2. **Request a fresh challenge** — Navigate to the login screen and request a new challenge. Challenges are time-limited and expire after a few minutes.
3. **Verify network settings** — Check the network shown in your wallet extension:
   - **Testnet:** `Test SDF Network ; September 2015`
   - **Mainnet:** `Public Global Stellar Network ; September 2015`
   - The application will reject signatures signed under the wrong network.
4. **Clear and reconnect** — If the problem persists, disconnect the wallet from the app, refresh the page, and reconnect.

### Q: I keep seeing "Connection was declined by user" but I approved it.

**Possible causes:**

- The wallet extension needs to be unlocked before the action.
- A browser extension blocker (e.g., ad blocker) is interfering with the wallet popup.

**Remedies:**

1. **Unlock first** — Unlock your wallet *before* clicking Connect or Sign in the application.
2. **Disable blockers** — Temporarily disable ad blockers or privacy extensions for the application domain.
3. **Wait for the popup** — Some wallet extensions open a popup window. If it does not appear, check if your browser blocked it and allow popups for the application domain.

---

## Network Mismatches

### Q: I get "Network mismatch" or "NetworkPassphrase mismatch" errors.

**Possible causes:**

- The wallet is connected to a different Stellar network than the application expects.
- The application switched between testnet and mainnet.

**Remedies:**

1. **Check the app's network setting** — Look for a network indicator in the application (usually displayed in the header or settings).
2. **Switch your wallet** — Change the wallet network to match. In Freighter: Settings → Network → select Testnet or Mainnet.
3. **If using custom RPC URLs** — Ensure the custom network passphrase exactly matches what the Stellar network expects. A single character difference will cause this error.
4. **Relaunch after switching** — After changing the network in your wallet, reload the application.

---

## Rate Limiting & Retries

### Q: I see "Too many requests" or the app is slow after repeated wallet actions.

**Remedies:**

1. **Wait a moment** — The api rate-limits kick in after rapid repeated requests. Wait 30-60 seconds and try again.
2. **Avoid rapid clicking** — Each connect/sign action triggers a backend request. Click once and wait for the response.
3. **Check the Retry-After header** — If you have network inspector access, look for the `Retry-After` response header (value in seconds).

---

## "Wallet not installed" when it is installed

**Possible causes:**

- The wallet extension does not support this browser (e.g., Freighter requires a Chromium-based browser).
- The wallet is installed in a different browser profile.
- Extension injection is blocked by Content Security Policy (CSP) on a custom domain.

**Remedies:**

1. **Use Chrome/Brave/Edge** — Most Stellar wallets work best on Chromium-based browsers.
2. **Check the extensions list** — Go to `chrome://extensions` and confirm the wallet is listed and enabled.
3. **Try the mobile version** — If on mobile, use a Stellar-compatible mobile wallet that supports WalletConnect.
4. **For developers:** If running on a custom localhost port or domain, ensure the wallet allows that origin. Some wallets restrict injection to specific domains.

---

## Still stuck?

If none of the above solutions resolve your issue:

1. **Check the browser console** — Open the developer tools (F12) and look for red error messages. These often contain clues.
2. **Look for `WalletError` codes** — The application logs wallet error codes (e.g., `USER_DECLINED`, `WALLET_NOT_INSTALLED`, `NETWORK_MISMATCH`) to the console.
3. **Open a GitHub Discussion** — [Start a new discussion](https://github.com/ritik4ever/stellar-portfolio-rebalancer/discussions) and include:
   - Your browser and wallet type
   - The exact error message shown
   - Any console errors (you can take a screenshot)
4. **Check the known issues** — The [README.md](../README.md) and [CHANGELOG.md](../CHANGELOG.md) may list known wallet compatibility issues.

---

## Wallet Adapter Reference

The application supports the following Stellar wallets:

| Wallet | Type | Browser Support | Notes |
|--------|------|-----------------|-------|
| **Freighter** | Browser extension | Chrome, Brave, Edge | Best support. Recommended for development. |
| **Rabet** | Browser extension | Chrome, Brave, Edge | Also supports React Native via SDK. |
| **xBull** | Browser extension | Chrome, Firefox, Brave | Works via `window.xbull` injection. |
| **WalletConnect** | Protocol | Mobile wallets | Planned for future support. |

For implementation details, see [`frontend/src/utils/walletAdapters.ts`](../frontend/src/utils/walletAdapters.ts).
