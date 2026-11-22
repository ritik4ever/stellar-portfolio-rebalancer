# Backend oracle quotes

The price feed prefers fresh Reflector quotes and requests CoinGecko only for assets with a missing, stale, or invalid Reflector quote. A Reflector fetch and body read have a shared five-second timeout before falling back. Valid Reflector quotes in the same batch remain available if CoinGecko fails. When a provider batch supplies only some requested assets, the result reports `partial_merge` and `staleOrLimited: true`. Redis hits with missing assets also report these flags. The existing cache and synthetic-price policies apply when neither provider supplies a usable quote.

## Integer precision

For a scaled Reflector quote, `price` is a positive signed-128-bit integer and `decimals` is the number of decimal places (0–38). Reflector integrations must send integers outside JavaScript’s safe integer range as decimal strings. The backend applies the scale before converting to a number and checks that the serialized decimal price yields the exact original integer at that scale. An unsafe JSON integer or an inexact numeric conversion stops processing that asset’s Reflector quote immediately. CoinGecko can supply its own quote for that asset. Unscaled feeds can also send ordinary positive decimal prices.

Rejected Reflector quotes never update the asset’s freshness or enter the price cache. Overlapping price reads share one resolution per backend instance, including the Redis cache write. Each caller receives its own response object. If resolution fails, a later request can resolve again under the existing provider cooldown.

## Accepted Reflector quotes

SQLite commits each accepted quote's source, price, ledger, and timestamp together with the asset registry freshness update. A write failure leaves the previous quote and freshness intact. The normal fallback policy applies to the failed asset, while successful writes for other assets remain available. Older ledgers are checked against the last committed Reflector quote, including after a restart. A Redis entry with a Reflector quote is usable only when that quote matches the committed record.

## Operator logs

| Log message | Outcome | Reasons and action |
| --- | --- | --- |
| `[ORACLE] quote_precision` | `success` | `normalized` identifies the Reflector asset and scale accepted by the feed. |
| `[ORACLE] quote_precision` | `delayed` | `in_flight` means the caller joined an existing price resolution. `timeout` indicates the Reflector request exceeded its deadline. |
| `[ORACLE] quote_precision` | `blocked` | `integer_overflow` means the quote could not preserve its units. Check the upstream integer encoding, scale, and range. `invalid_quote` indicates a malformed amount or unsupported scale. |
| `[ORACLE] price_ingestion` | `blocked` | `PERSISTENCE_FAILED` means the database did not commit the quote and the normal fallback path was used. |
| `[ORACLE] coingecko_fallback` | `success` | `fetched` or `cache_hit` identifies the returned CoinGecko quote. `price_disagreement` is a warning on a served quote and includes the asset, deviation, and tolerance in basis points. |
| `[ORACLE] coingecko_fallback` | `delayed` | `local_rate_limit`, `provider_rate_limit`, or `timeout` indicates a cooldown or slow provider. |
| `[ORACLE] coingecko_fallback` | `blocked` | `no_valid_quote`, `invalid_response`, `http_error`, or `request_failed` identifies an asset or upstream request that could not supply a fallback. HTTP status is included when available. |

CoinGecko diagnostics identify the free or pro source. When a valid stale Reflector quote is already available for the same asset, deviation is the absolute price difference divided by the higher price. Deviations above 300 bps emit a warning. The stale quote serves as diagnostic context and the existing fallback selection still applies. The comparison requires no extra provider calls.

These events omit URLs, credentials, raw quotes and provider response bodies.
