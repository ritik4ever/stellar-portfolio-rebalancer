# Wallet action announcements

How the wallet-related dialogs tell keyboard and screen-reader users what is allowed, what each choice does, and where focus is.

## The allowed value

The app accepts exactly one network: the configured one (`VITE_STELLAR_NETWORK`, shown as *Testnet*, *Mainnet (Public)*, etc. via `networkLabel()` in `utils/networkDetection.ts`). Every message that rejects or questions a network names it:

- Pre-connect mismatch: "Wallet is on *X*, but this app only accepts *Y*. Switch your wallet to *Y* and select it again."
- Connect error `NETWORK_MISMATCH`: "Your wallet is on a different network. This app only accepts *Y*: switch your wallet to *Y*, then select it again."
- Network switch dialog: "This app is set to *Y*." followed by either "Your wallet now matches it." or "Transactions will fail while your wallet is on *X*; only *Y* is accepted."

## Network switch dialog (`NetworkSwitchModal`)

| Aspect | Behaviour |
| --- | --- |
| Semantics | `role="dialog"`, `aria-modal`, labelled by its title, described by the summary, the allowed-network sentence and (for Mainnet) the funds warning |
| Initial focus | **Cancel Switch**, the non-destructive choice, so an accidental Enter never moves the app towards Mainnet |
| Tab / Shift+Tab | Cycle inside the dialog |
| Escape | Rejects the switch (same as Cancel) |
| Confirm button | Described by its outcome: the app treats the wallet as being on the new network and reloads data; transactions fail until the wallet is back on the allowed network |
| Cancel button | Described by its outcome: the app keeps the current network, the wallet stays on the new one, and you won't be asked about it again |
| After either choice | Focus returns to the control that had it before the dialog opened; a persistent polite status region in `App` announces the result ("Network switch confirmed…" / "Network switch cancelled…"), because the dialog itself unmounts |

## Wallet selection (`WalletSelector`, `Landing` dialog)

- The dialog is `role="dialog"`, labelled "Select Wallet", with a close button named "Close wallet selection". Escape closes it and focus returns to the button that opened it.
- A polite status region announces "Connecting to *Wallet*. Approve the request in your wallet." and "Connected to *Wallet*.".
- Failures appear in a single `role="alert"` next to the wallet buttons, and the pressed button is `aria-describedby` that message. Focus is returned to the pressed button. (A pre-connect network mismatch is announced once, by the existing mismatch banner.)
- Declined and timed-out messages say nothing was connected and what to do next.
- While a request is pending the buttons use `aria-disabled` (not `disabled`) so focus is not lost, and further presses are ignored, so only one wallet prompt exists at a time.
- Enter and Space activate through the native button click only; there is no second key handler that could fire twice.
- If the dialog is closed while the wallet prompt is open, a later success is ignored and the wallet is disconnected rather than signing the user in unexpectedly.

## Tests

`NetworkSwitchModal.test.tsx`, `WalletSelector.announcements.test.tsx`, `WalletSelector.test.tsx`, `Landing.walletDialog.test.tsx`.
