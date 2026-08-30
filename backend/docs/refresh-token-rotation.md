# Refresh Token Rotation

Refresh tokens are single-use and rotate within a **family** (#1406).

## Families and generations

A family is one login session's chain of rotated refresh tokens.

- **Login** (`issueTokens`) opens a new family at generation 0.
- **Refresh** (`refreshTokens`) retires the presented token and issues generation *n+1*
  inside the same family. A user's other devices each have their own family.
- The retired token's hash is written to `refresh_token_rotations`, which is what makes
  a later replay detectable.

Every refresh token also carries its family id in the JWT (`fid`), alongside `jti`.

## Reuse detection

Presenting an already-rotated token is treated as a compromise signal — either the
token was stolen, or a legitimate client is racing itself:

1. The token is not in `refresh_tokens` (it was deleted on rotation).
2. It **is** in `refresh_token_rotations`, so this is a replay.
3. The whole family is revoked: marked `revoked` with reason `reused_rotated_token`,
   and every live token in it is deleted. Every session in that chain — including the
   attacker's freshly minted one — is logged out.
4. An audit event records the family id and the replayed generation.

Other families are untouched, so a compromise on one device does not sign the user out
everywhere. A live token whose family was revoked is refused on its next use.

The rotations index is authoritative and works without Redis. The Redis-backed
revocation list is still consulted as a fallback so tokens revoked by other paths
(logout-all) keep their existing behaviour.

## Storage

| Table | Purpose |
| --- | --- |
| `refresh_token_families` | `id`, `user_address`, `current_generation`, `revoked`, `revoked_reason` |
| `refresh_token_rotations` | `token_hash` → `family_id`, `generation`, `expires_at` |
| `refresh_tokens` | gains `family_id` and `generation` columns |

Migration: `015_refresh_token_families`. `pruneExpiredRotations()` drops rotation
records once the underlying token would have expired anyway.

Tokens minted before this feature have no family; they are adopted into a new one on
their next rotation, so the very next refresh is protected.
