# Wallet authorization outcomes

The existing structured audit logger emits `action=wallet_authorization` for both
backend wallet verification paths. Filter by `source=wallet_signature` for
the active `POST /api/auth/challenge` and `/api/auth/login` flow
(`issueChallenge` / `authenticateWalletSignature`). The direct
`verifyWalletSignature` helper remains available for signature-only callers.
`source=stellar_challenge` covers `createChallenge` / `verifyChallenge`,
including `/api/auth/verify`.
The router currently registers `/challenge` twice; the earlier legacy handler
responds first. This change preserves that existing routing behavior.

| Outcome / reason | Meaning and operator action |
| --- | --- |
| `pending` / `challenge_issued` | Waiting for the wallet to sign; challenge TTL remains five minutes. |
| `pending` / `issuing_tokens` | Signature accepted; token persistence is in flight for `/api/auth/login` or `/api/auth/verify`. A prolonged pending record without a terminal record warrants checking database/process health. |
| `success` / `authorized` | The HTTP login/verify path emits this only after tokens are issued. The direct `verifyWalletSignature` helper retains its signature-only success semantics. |
| `blocked` / `wrong_network` | The signature verifies over a recognized alternate-network message. Check `expectedNetwork` and `detectedNetwork`, then have the client sign the exact issued message. |
| `blocked` / `invalid_signature` | Invalid, malformed, another account's signature, or an unrecognized signed message. Do not assume a network mismatch. |
| `blocked` / `missing_challenge` or `expired_challenge` | Request a fresh challenge and sign it before expiry. |
| `blocked` / `reused_challenge` | A signature was presented for a challenge already consumed after valid verification (whether token issuance later succeeded or failed). Terminal: the bound challenge cannot be revived; request a fresh one. |
| `blocked` / `invalid_address` | The HTTP challenge verifier rejected the address. |
| `blocked` / `token_issuance_failed` | Signature verification passed but token issuance failed; the HTTP route returns `500`, no successful authorization is recorded, and the consumed challenge cannot be retried. Inspect correlated service health and request a fresh challenge. |

`walletId` and `challengeId` are SHA-256 identifiers for correlation; they are not
credentials. Network context is captured at challenge issuance from
`STELLAR_NETWORK` (default `testnet`). Existing logger context adds request,
correlation and trace IDs when available. `attempts`, `remainingAttempts` and
`retryable` distinguish another permitted attempt from a consumed challenge.
The HTTP path retains three attempts; the legacy path consumes on any attempt.

## Expired or reused signed challenges at the service boundary

Both HTTP verification flows (`verifyChallenge` for `stellar_challenge`,
`authenticateWalletSignature` for `wallet_signature`) treat an expired or
replayed signed challenge as a terminal rejection: no tokens are issued, the
decision is `blocked` with `retryable: false`, and the HTTP result stays
`401 UNAUTHORIZED` on `/api/auth/login` and `/api/auth/verify`. Signatures are
never re-checked against an expired challenge; expiry is decided before
verification. The direct `verifyWalletSignature` helper remains signature-only
for existing service callers.

To keep that decision stable, each service records the bound challenge context
(`walletId`, `challengeId`, `expectedNetwork` captured at issuance) when a
challenge reaches a terminal state — consumed once its signature verifies, or
expired (including background cleanup). Consumption is final even if token
persistence subsequently fails. A later attempt with no active challenge
consults that record within the same authentication path:

- Replay of a consumed challenge: `reused_challenge`, documented with the bound
  account, nonce, and network of the challenge it replays.
- Attempt after expiry, including after cleanup: `expired_challenge`, likewise
  bound to the original issuance context.
- No terminal record (never issued, exhausted-retry purge, or older than the
  fifteen-minute replay window): `missing_challenge` with account and network
  only — no nonce can be attributed, and none is invented.

Terminal records are kept for fifteen minutes per wallet and path, keyed only by
the hashed `walletId`; raw addresses, nonces, and signatures are never retained
or logged. Record retention classifies the audit decision only — it never
authorizes, and clearing it falls back to the pre-existing `missing_challenge`
rejection.

## Login persistence and concurrent attempts

For the mounted `/api/auth/login` flow, a valid signature consumes the challenge
synchronously before token persistence can yield. This keeps parallel submissions
single-use: one request can issue tokens, and a concurrent replay is rejected
with `401` and correlated to the same hashed account, challenge, and network
captured when the challenge was issued. Changing `STELLAR_NETWORK` while token
persistence is pending does not rewrite that context.

The login flow records `pending / issuing_tokens` before persistence and records
`success / authorized` only after token issuance completes. If issuance rejects,
it records `blocked / token_issuance_failed` and the route returns `500`; it does
not emit a success outcome or make the consumed challenge retryable. The caller
must request and sign a fresh challenge. A process interruption can leave a
pending record without a terminal event; do not interpret pending as successful
authorization.

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
