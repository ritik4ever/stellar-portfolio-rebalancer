# Backend oracle quotes

The price feed prefers fresh Reflector quotes and requests CoinGecko only for assets with a missing, stale, or invalid Reflector quote. A Reflector fetch and body read have a shared five-second timeout before falling back. Valid Reflector quotes in the same batch remain available if CoinGecko fails. When a provider batch supplies only some requested assets, the result reports `partial_merge` and `staleOrLimited: true`. Redis hits with missing assets also report these flags. The existing cache and synthetic-price policies apply when neither provider supplies a usable quote.

## Integer precision

For a scaled Reflector quote, `price` is a positive signed-128-bit integer and `decimals` is the number of decimal places (0–38). Reflector integrations must send integers outside JavaScript’s safe integer range as decimal strings. The backend applies the scale before converting to a number and checks that the serialized decimal price yields the exact original integer at that scale. An unsafe JSON integer or an inexact numeric conversion stops processing that asset’s Reflector quote immediately. CoinGecko can supply its own quote for that asset. Unscaled feeds can also send ordinary positive decimal prices.

Rejected Reflector quotes never update the asset’s freshness or enter the price cache. The ingestion boundary checks ledger ordering before freshness: an older ledger is an explicit stop for that quote during the current resolution, is not retried, and is logged as `OLDER_LEDGER` even if its timestamp is also stale. The regular fallback policy may still run once for the missing asset; only a quote accepted by the boundary is persisted. Overlapping price reads share one resolution per backend instance, including the Redis cache write. Each caller receives its own response object. If resolution fails, a later request can resolve again under the existing provider cooldown.

## Accepted Reflector quotes

SQLite commits each accepted quote's source, price, ledger, and timestamp together with the asset registry freshness update. A write failure leaves the previous quote and freshness intact. The normal fallback policy applies to the failed asset, while successful writes for other assets remain available. Older ledgers are checked against the last committed Reflector quote, including after a restart. A Redis entry with a Reflector quote is usable only when that quote matches the committed record.

## Operator logs

| Log message | Outcome | Reasons and action |
| --- | --- | --- |
| `[ORACLE] quote_precision` | `success` | `normalized` identifies the Reflector asset and scale accepted by the feed. |
| `[ORACLE] quote_precision` | `delayed` | `in_flight` means the caller joined an existing price resolution. `timeout` indicates the Reflector request exceeded its deadline. |
| `[ORACLE] quote_precision` | `blocked` | `integer_overflow` means the quote could not preserve its units. Check the upstream integer encoding, scale, and range. `invalid_quote` indicates a malformed amount or unsupported scale. |
| `[ORACLE] price_ingestion` | `success` | The Reflector quote for the asset was accepted and persisted. `reasonCode` is `FRESH` or `FRESH_AT_LIMIT`; the latter means the quote age exactly matches `PRICE_DATA_MAX_AGE` and is still accepted. `observedLedger`, `acceptedLedger`, `acceptedPrice` and `ageMs` identify the committed quote. |
| `[ORACLE] price_ingestion` | `delayed` | `STALE_QUOTE` means the oracle returned a quote older than the freshness window; the asset falls back to CoinGecko. `quoteAgeSeconds`, `ageMs`, `observedLedger`, and the last accepted ledger/price/source show the rejected quote and the boundary it failed. |
| `[ORACLE] price_ingestion` | `blocked` | `MISSING_QUOTE` means the oracle returned no row for the asset. `INVALID_QUOTE` means the amount or scale could not be normalized. `OLDER_LEDGER` includes observed ledger/price next to the accepted ledger/price/source, identifying a replay; it is not retried during the current resolution. `PERSISTENCE_FAILED` means the database did not commit the quote and the normal fallback path was used. |
| `[ORACLE] coingecko_fallback` | `success` | `fetched` or `cache_hit` identifies the returned CoinGecko quote for the asset. |
| `[ORACLE] coingecko_fallback` | `delayed` | `local_rate_limit`, `provider_rate_limit`, or `timeout` indicates a cooldown or slow provider. |
| `[ORACLE] coingecko_fallback` | `blocked` | `no_valid_quote`, `invalid_response`, `http_error`, or `request_failed` identifies an asset or upstream request that could not supply a fallback. `price_disagreement` means the fallback quote deviated from the last Reflector reference beyond tolerance; the quote is explicitly stopped — it is neither served nor cached, so a later retry re-evaluates it without duplicating side effects. `freshness_persist_failed` means the asset freshness record could not be written, so the quote was withheld to keep the persisted record and the served result consistent. HTTP status is included when available. |

CoinGecko diagnostics identify the free or pro source. When a valid stale Reflector quote is already available for the same asset, deviation is the absolute price difference divided by the higher price, reported in basis points against the 300 bps tolerance. A deviation above tolerance blocks the fallback quote for that asset; the comparison requires no extra provider calls. Cached fallback quotes are re-validated against the latest Reflector reference on every hit, and a disagreeing entry is dropped rather than served. Freshness is persisted before a fallback quote becomes visible, so an interrupted write cannot leave caches serving an unrecorded price.

For scaled Reflector quotes, successful `price_ingestion` and `quote_precision` events include `units` (the conserved signed-128-bit integer token units) and `decimals` (the asset's scale, 0–38), so operators can verify `price = units × 10^-decimals` across assets with different decimal scales.

These events omit URLs, credentials, raw quotes and provider response bodies.
