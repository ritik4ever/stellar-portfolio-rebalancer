# Wallet Troubleshooting FAQ

Common wallet connection, signature, and network mismatch issues — and how to fix them without reading source code first.

&gt; **Quick Jump:** [Connection Issues](#connection-issues) · [Signature Failures](#signature-failures) · [Network Mismatch](#network-mismatch) · [Wallet-Specific Guides](#wallet-specific-guides) · [Developer/Debug](#developer-debug)

---

## Connection Issues

### "Wallet is not installed" (`WALLET_NOT_INSTALLED`)

**Symptom:** Clicking "Connect Wallet" shows an error saying your wallet is not installed.

**Check:**

1. **Is the wallet extension actually installed?**
   - Freighter: Check for the orange rocket icon in your browser toolbar
   - Rabet: Check for the blue "R" icon
   - xBull: Check for the purple "X" icon

2. **Is the extension enabled?**
   - Chrome: `chrome://extensions` → ensure the wallet is toggled on
   - Firefox: `about:addons` → ensure the wallet is enabled

3. **Are you in a private/incognito window?**
   - Most wallet extensions are disabled in private browsing by default
   - Use a normal browser window

**Fix:**

```bash
# Install links
Freighter:  https://www.freighter.app/
Rabet:      https://rabet.io/
xBull:      https://xbull.app/
LOBSTR:     https://lobstr.co/
```

If the extension is installed but is still not detected, refresh the page after
unlocking it. Browser privacy extensions can also prevent a wallet from being
detected; temporarily allow this site and try again.

## Signature Failures

### "Connection was declined" or a signing request never appears

**Check:** Unlock the selected wallet and look for a pending connection or
transaction-approval prompt. A browser can block the popup if it was not opened
directly from a click.

**Fix:** Approve the request in the wallet, allow popups for this site, then
reopen the wallet selector and retry. Do not approve a request whose account,
network, or transaction details you do not recognise.

## Network Mismatch

### "Network mismatch"

**Symptom:** The application reports that the wallet network is different from
the network it expects.

**Fix:** Select the same network in the wallet and the application, then retry
the connection. Testnet and mainnet accounts, balances, and assets are separate.

The application detects a mismatch before connecting in
[`WalletSelector.tsx`](../frontend/src/components/WalletSelector.tsx). Its
`NetworkMismatchBanner` reports the configured and detected networks.

## Wallet-Specific Guides

### LOBSTR

LOBSTR is commonly used as a mobile wallet. The wallet picker includes it as a
supported option, but browser-extension detection intentionally does not mark it
as installed because the normal flow may require a mobile or WalletConnect-style
handoff. See [`WalletPicker.tsx`](../frontend/src/components/WalletPicker.tsx)
for that detection behaviour and [`WalletSelector.tsx`](../frontend/src/components/WalletSelector.tsx)
for the connection flow and network check.

#### Connection failures

- Confirm that LOBSTR is installed, up to date, and unlocked, then start the
  connection again from the application rather than from a stale mobile prompt.
- If a QR code or handoff is shown, scan it with the same device/account you
  intend to use and complete the request before it expires.
- If the browser cannot detect a wallet, refresh after unlocking it and disable
  any privacy setting that blocks the handoff. Try a normal (non-private)
  browser window.

#### Signing errors

- Open LOBSTR and approve the pending request. Rejecting, closing, or allowing
  the request to expire appears as a declined or failed signature in the app.
- Verify the public key, amount, asset, and destination before approving. If
  those details differ from what you intended, reject the request and restart.
- If the approval prompt does not open, allow popups for the application and
  retry from the wallet selector.

#### Network mismatch

- Ensure that the account and network selected in LOBSTR match the network
  reported by the application. Switching between testnet and mainnet requires a
  fresh connection.
- Mainnet and testnet funds are distinct; never send mainnet funds to a testnet
  address or assume a testnet balance will appear on mainnet.

For account and app help, use the [LOBSTR Help Center](https://lobstr.freshdesk.com/support/home).

### Hana

Hana connections use the same application entry points as other wallets:
[`WalletPicker.tsx`](../frontend/src/components/WalletPicker.tsx) presents the
wallet choices, while [`WalletSelector.tsx`](../frontend/src/components/WalletSelector.tsx)
handles connection errors and rejects a detected network mismatch before signing.

#### Connection failures

- Confirm that the Hana extension or mobile app is installed, enabled, updated,
  and unlocked. Reload the application after installing or enabling it.
- Use a standard browser window and allow the application to open wallet
  popups. Private browsing and popup blockers can prevent the connection
  request from reaching Hana.
- If a previous request is still pending, cancel it in Hana, refresh the page,
  and initiate one new request from the wallet selector.

#### Signing errors

- Review and approve the exact request in Hana. A rejected, timed-out, or
  cancelled approval is reported as a signing failure by the application.
- Confirm that the selected Hana account is the account displayed in the app;
  switch accounts in Hana and reconnect if necessary.
- Update Hana if it cannot display or approve the request, then retry with one
  newly initiated transaction rather than reusing an expired prompt.

#### Network mismatch

- Select the same network in Hana that the application is configured to use,
  then reconnect so the selector can detect the current network again.
- If the mismatch banner persists, disconnect, switch networks in Hana, reload
  the page, and connect again. This clears cached connection state.

For installation and wallet support, visit [Hana Wallet](https://hana.finance/).

## Developer/Debug

When helping a user, record the selected wallet, browser, configured network,
and the exact error text. Do not request seed phrases, private keys, or recovery
codes. The selector can show startup diagnostics when no browser wallet is
available; see [`WalletSelector.tsx`](../frontend/src/components/WalletSelector.tsx).
