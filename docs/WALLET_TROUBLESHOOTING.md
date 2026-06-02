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