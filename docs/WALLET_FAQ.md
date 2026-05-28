# Wallet Connection & Signature FAQ

## Connection Issues

### "Wallet not found" / "No wallet detected"
- Ensure your wallet extension (Freighter, Rabet, etc.) is installed
- Reload the page after installing
- Check that the extension is enabled for this domain

### "Network mismatch"
- The app runs on Stellar Testnet by default
- Switch your wallet to Testnet
- Freighter: Settings → Network → Testnet

### Connection drops after a few minutes
- Some wallets disconnect on page refresh
- Reconnect by clicking the wallet button again
- Session expiry is normal for security

## Signature Failures

### "Signature rejected" / "User denied"
- You clicked Cancel in the wallet prompt
- Try again and approve the signature request
- Check that your wallet is unlocked

### "Invalid signature"
- The signed payload may be malformed
- Clear your browser cache and retry
- Ensure your wallet is on the correct network

### Transaction fails to submit
- Check that your account has test XLM (use Friendbot)
- Ensure the sequence number is correct
- Wait a few seconds and retry

## Common Errors

### `ERR_BAD_SIGNATURE`
The signature doesn't match the expected payload. Reconnect your wallet and try again.

### `ERR_EXPIRED`  
The request timed out. The signature window was open too long. Close and retry.

### `ERR_WRONG_NETWORK`
Your wallet is on a different Stellar network. Switch to Testnet (or Mainnet for production).

## Still Stuck?
Open an issue with:
1. Browser and wallet version
2. Error message (screenshot if possible)
3. Steps that led to the error
