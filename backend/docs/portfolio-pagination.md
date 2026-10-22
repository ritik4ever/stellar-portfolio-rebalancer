# Portfolio API Pagination Boundary Handling and Observability (SPR-2026-181 & SPR-2026-184)

> **Related Issues**: Fixes #2105 (SPR-2026-181) & Fixes #2108 (SPR-2026-184)  
> **Batch ID**: SPR-2026-181  
> **Area**: backend  

## Overview

The Portfolio API (`GET /api/portfolios` and `GET /api/v1/portfolios`) implements cursor-based keyset pagination to provide a predictable, stable, and deterministic portfolio listing.

Cursor-based keyset pagination prevents duplicate and missed rows that occur with traditional `LIMIT` / `OFFSET` pagination when records are inserted or deleted while a client traverses pages.

In addition, comprehensive observability signals allow operators to distinguish between `success`, `delayed`, and `blocked` work, and to diagnose dataset mutations occurring during traversal without exposing any secrets.

---

## Public Service Boundary Contract (SPR-2026-181)

### Deterministic Keyset Ordering

All portfolio listing queries are strictly ordered by:
```sql
ORDER BY created_at ASC, id ASC
```
- **Oldest items first**: Traversal starts from the oldest created portfolios and progresses forward to the newest.
- **Tie-breaking**: When multiple portfolios share identical `created_at` timestamps, `id` (UUID) ensures a total, unambiguous ordering.

### Cursor Format

The pagination `cursor` is a deterministic, URL-safe base64-encoded string representing the keyset coordinate of the last item on the previous page:
```json
{
  "createdAt": "2026-10-22T08:00:00.000Z",
  "id": "portfolio-001",
  "total": 45
}
```
Clients must treat cursors as opaque tokens.

### Response Envelope

Every paginated portfolio response returns:
```json
{
  "success": true,
  "data": {
    "portfolios": [ ... ],
    "limit": 20,
    "cursor": null,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTIyVDA4OjAwOjAwLjAwMFoiLCJpZCI6InBvcnRmb2xpby0wMDEiLCJ0b3RhbCI6NDV9",
    "count": 20,
    "total": 45
  },
  "error": null,
  "timestamp": "2026-10-22T10:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `portfolios` | `Array<Portfolio>` | The items returned for the current page. |
| `limit` | `number` | The requested page size (clamped between 1 and 100, default 20). |
| `cursor` | `string \| null` | The cursor supplied in the request, or `null` for the first page. |
| `nextCursor` | `string \| null` | Opaque cursor to pass into the next page request, or `null` on the final page. |
| `count` | `number` | Number of items returned in the current page (`portfolios.length`). |
| `total` | `number` | Total number of items matching the query filters (unaffected by page size or cursor). |

### Boundary Cases

1. **First Page**:
   - Client sends no `cursor` (or `cursor` is omitted/null).
   - Response returns the oldest items up to `limit`.
   - `cursor` in response is `null`.
   - `nextCursor` is populated if more items exist, or `null` if all items fit in the first page.

2. **Final Page**:
   - Response returns the newest matching items.
   - `nextCursor` is `null`, indicating pagination has reached the end of the result set.

3. **Empty Result**:
   - When no portfolios match the query (or the system has 0 portfolios):
     - `portfolios: []`
     - `count: 0`
     - `total: 0` (or the total matching count if cursor was beyond the end)
     - `nextCursor: null`
     - `cursor: <supplied cursor> | null`

4. **Stable Cursor**:
   - Repeating a request with the exact same cursor returns the exact same items and `nextCursor` while underlying data is unchanged.
   - Cursors are safe for repeated retries and idempotent replays.

5. **Reported Count**:
   - `total` represents the total number of records matching the query parameters (`search`, `userAddress`, `include_archived`).
   - `total` is stable across pages and is **not affected by the page size** (`limit`).

6. **Items Changing During Pagination**:
   - Concurrent inserts with older timestamps or deletes of earlier items do not shift subsequent pages or cause duplicate/missed rows.
   - Keyset predicate `(created_at > :createdAt) OR (created_at = :createdAt AND id > :id)` ensures strict progression.

7. **Invalid Cursor Handling**:
   - Malformed or corrupt cursor strings return HTTP `400 Bad Request` with error code `INVALID_CURSOR`.

---

## Observability & Actionable Outcomes (SPR-2026-184)

Operators can distinguish between **success**, **delay**, and **blocked** work from available metrics and structured logs.

### Operator Signals

| State | Condition | Operator Meaning | Available Signals |
|---|---|---|---|
| `success` | Valid page retrieved, cursor advanced cleanly. | Traversal proceeding normally. | Metric: `portfolio_pagination_requests_total{state="success"}`<br>Log: `info` level, event `portfolio_pagination` |
| `delayed` | Transient database retry, connection timeout, lock contention. | Temporary lag/backoff. Replay is safe; work is delayed rather than dead. | Metric: `portfolio_pagination_requests_total{state="delayed"}`<br>Log: `warn` level with timeout context |
| `blocked` | Malformed/invalid cursor (`INVALID_CURSOR`), client validation failure, unrecoverable query error. | Request rejected or blocked. Automated retries will not succeed without client correction. | Metric: `portfolio_pagination_requests_total{state="blocked"}`<br>Log: `warn` level with `reason: "malformed_cursor"` |

### Diagnosing Items Changing During Pagination

When dataset mutations happen while a client paginates, the cursor coordinates diagnose the shift:
- `items_inserted`: Underlying total increased between page fetches (`total > cursor.total`).
- `items_deleted`: Underlying total decreased between page fetches (`total < cursor.total`).
- Metrics counter: `portfolio_pagination_items_changed_total{source, change_kind}`.

### Zero Secret Exposure

All context logging passes through `sanitizePaginationContext` and the centralized `secretRedactor`:
- Stellar secret keys (`S...`), private keys, API keys, passwords, and bearer tokens are automatically scrubbed (`[REDACTED]`).
- Only safe operational identifiers (`source`, `limit`, `count`, `total`, `changeKind`, `durationSeconds`) are emitted in signals.

---

## Testing

Deterministic coverage using isolated DB doubles is provided in:
- `backend/src/test/portfolio.pagination.test.ts`
