# Wallet Connection & Signature FAQ

Frequently asked questions about wallet connection, Stellar signature generation, and troubleshooting common failures.

## Wallet Connection

### Q: How do I connect my Freighter wallet?
Install the [Freighter](https://freighter.app/) browser extension, create or import a wallet on the Stellar Testnet, and click "Connect Wallet" on the rebalancer frontend. Approve the connection request in the Freighter popup.

### Q: Which network does the rebalancer use?
The default configuration uses Stellar Testnet. You can switch to Mainnet by updating the `STELLAR_NETWORK` environment variable in your `.env` file.

### Q: I don't see the Connect Wallet button
Make sure:
1. Freighter extension is installed and enabled
2. You are on the correct domain (no local file:// URLs)
3. Your browser is up to date (Chrome, Firefox, or Brave recommended)

## Signature Generation

### Q: What does signing prove?
Signing a payload with your Stellar private key proves you control that account. The backend verifies the signature against the stored maintainer public keys.

### Q: How is the signature payload constructed?
The payload includes the action type, a nonce (to prevent replay attacks), and a timestamp. Example:
```
POST /api/rebalance
X-Stellar-Public-Key: G...
X-Stellar-Signature: <base64-encoded signature>
X-Stellar-Nonce: abc123
X-Stellar-Timestamp: 1700000000000
```

### Q: Can I sign programmatically (without Freighter)?
Yes. Use the Stellar SDK:

```javascript
const { Keypair } = require('@stellar/stellar-sdk');
const keypair = Keypair.fromSecret('S...');
const message = `${nonce}:${timestamp}:${action}`;
const signature = keypair.sign(Buffer.from(message));
```

## Troubleshooting

### Q: I get "Invalid Signature" (401)
Common causes:
- Using the wrong Stellar account (check public key)
- Payload mismatch between what was signed and what the server receives
- Expired timestamp (signatures older than 5 minutes are rejected)

### Q: Transaction fails with "Timeout"
- Check your internet connection
- Ensure the Soroban RPC endpoint is accessible
- Try increasing the timeout in your wallet settings

### Q: Wallet says "Network Mismatch"
Your Freighter wallet is on a different network than the rebalancer expects. Switch networks in Freighter settings to match.

## Still Stuck?

Open a [GitHub issue](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/new) with:
- Your Freighter version
- The exact error message
- Steps to reproduce
