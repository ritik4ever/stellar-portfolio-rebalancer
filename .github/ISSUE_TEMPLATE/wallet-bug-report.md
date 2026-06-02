---
name: Wallet bug report
about: Use this template for wallet connection, signing, or network issues in Freighter, Rabet, xBull, or other Stellar wallets.
title: "[wallet] "
labels: bug, frontend, triage
assignees: ''
---

## Summary
Briefly describe the wallet bug you hit.

Example: "Freighter connection succeeds on the wallet selector, but the signature prompt fails on testnet with a network mismatch error."

## Wallet details
Please complete the following so the report is actionable:

- Wallet type: Freighter / Rabet / xBull / Other
- Wallet version or extension version:
- Browser + version:
- OS:
- Stellar network: testnet / public / custom
- Did the wallet popup appear? Yes / No
- Did you approve or decline the signature request? Approved / Declined / Not shown
- If the bug surfaced as an error, which code did you see? `USER_DECLINED`, `WALLET_NOT_INSTALLED`, `NETWORK_MISMATCH`, `TIMEOUT`, or other

## Steps to reproduce
1. Open the app and choose the wallet in the selector.
2. If applicable, switch the wallet network to the one used in your report.
3. Trigger the action that fails (connect, reconnect, sign, rebalance, etc.).
4. Note the exact button, page, or flow used.

## Expected behavior
What should happen in the wallet flow?

## Actual behavior
What happened instead? Include any error message shown in the app or wallet extension.

## Evidence
Attach any of the following that are helpful:

- Screenshot of the wallet popup or error state
- Browser console log or network log
- The exact public key or wallet account used (if safe to share)
- A short note about whether the issue is reproducible on a fresh page reload

## Additional context
Add anything else that might help maintainers, such as whether the issue happens only with one wallet, only on one browser, or only on testnet/public network.

## Maintenance note
Use this template when the failure involves wallet selection, extension detection, wallet popup approval, signing behavior, or network mismatch handling. If you are not sure whether the issue is wallet-specific, start with the standard bug report and include the details above.
