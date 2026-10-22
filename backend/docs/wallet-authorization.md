# Wallet authorization outcomes

The existing structured audit logger emits `action=wallet_authorization` for both
backend wallet verification paths. Filter by `source=wallet_signature` for
the active `POST /api/auth/challenge` and `/api/auth/login` flow
(`issueChallenge` / `verifyWalletSignature`). `source=stellar_challenge` covers
`createChallenge` / `verifyChallenge`, including `/api/auth/verify`.
The router currently registers `/challenge` twice; the earlier legacy handler
responds first. This change preserves that existing routing behavior.

| Outcome / reason | Meaning and operator action |
| --- | --- |
| `pending` / `challenge_issued` | Waiting for the wallet to sign; challenge TTL remains five minutes. |
| `pending` / `issuing_tokens` | Signature accepted; token persistence is in flight. A prolonged pending record without a terminal record warrants checking database/process health. |
| `success` / `authorized` | Verification finished. The HTTP challenge path emits this only after tokens are issued; the legacy helper only verifies a signature. |
| `blocked` / `wrong_network` | The signature verifies over a recognized alternate-network message. Check `expectedNetwork` and `detectedNetwork`, then have the client sign the exact issued message. |
| `blocked` / `invalid_signature` | Invalid, malformed, another account's signature, or an unrecognized signed message. Do not assume a network mismatch. |
| `blocked` / `missing_challenge` or `expired_challenge` | Request a fresh challenge and sign it before expiry. |
| `blocked` / `invalid_address` | The HTTP challenge verifier rejected the address. |
| `blocked` / `token_issuance_failed` | Signature verification passed but token issuance failed; inspect correlated service health and request a fresh challenge. No successful authorization is recorded. |

`walletId` and `challengeId` are SHA-256 identifiers for correlation; they are not
credentials. Network context is captured at challenge issuance from
`STELLAR_NETWORK` (default `testnet`). Existing logger context adds request,
correlation and trace IDs when available. `attempts`, `remainingAttempts` and
`retryable` distinguish another permitted attempt from a consumed challenge.
The HTTP path retains three attempts; the legacy path consumes on any attempt.

No signatures, raw challenges, tokens, private keys, request bodies or exception
text are added to these audit events. Treat wallet identifiers as pseudonymous
operational data and apply the existing log access/retention policy.

Network classification is diagnostic only. Existing raw-message challenge formats
remain unchanged and are not inherently network-bound. The classifier verifies
the signature against the opposite built-in Stellar testnet/mainnet passphrase
prefixed to the issued message. For legacy messages it also recognizes insertion
after `stellar-rebalancer:auth:`. Unknown message formats/configuration remain
`invalid_signature`; no client-supplied network label is trusted, no network RPC
is made, and an alternate-network signature never grants authorization.

Events describe this authentication step, not portfolio execution or on-chain
transaction success. A process crash can leave a pending event without a terminal
event; elapsed time and existing request/process telemetry distinguish that case
from a user still signing. No automatic retries or authorization bypass is added.
