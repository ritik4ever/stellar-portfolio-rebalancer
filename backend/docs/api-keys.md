# Scoped API Keys

Programmatic clients authenticate with the `X-API-Key` header. Keys are managed from
the web UI over JWT auth (`/api/v1/api-keys`) and are stored as salted scrypt hashes —
the raw key is returned exactly once, at creation or rotation, and never again.

## Scopes

| Scope        | Allowed |
| ------------ | ------- |
| `read-only`  | `GET`, `HEAD`, `OPTIONS` |
| `read-write` | All methods |

`POST /api/v1/api-keys` accepts `scope`, and defaults to `read-only` when it is
omitted, so a caller can never mint a write-capable key by accident. Rotation
(`POST /api/v1/api-keys/:id/rotate`) preserves the original key's scope.

The scope is included in every management response — key creation, rotation, and the
`GET /api/v1/api-keys` listing — alongside the key prefix and usage metadata. Key
hashes are never returned.

## Enforcement

`requireApiKey` authenticates the key, populates `req.apiKeyUser`
(`{ address, scope, keyId }`), and rejects a `read-only` key with **403 FORBIDDEN** on
any mutating request (`POST`, `PUT`, `PATCH`, `DELETE`). Enforcement lives in the
middleware rather than in individual routes, so a new write route is covered by
default.

For routes that are logically mutating but use a read verb, chain `requireReadWrite`
after `requireApiKey`:

```ts
router.get('/portfolio/:id/rebalance', requireApiKey, requireReadWrite, handler)
```

A key that has been rotated stays valid until its grace window
(`grace_expires_at`, default 5 minutes) elapses; after that it authenticates as
revoked and is rejected with 401.
