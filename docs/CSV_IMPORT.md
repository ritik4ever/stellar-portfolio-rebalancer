# Portfolio allocation CSV import

The backend accepts dependency-free CSV imports for portfolio allocations. The parser is implemented in `backend/src/services/portfolioImportService.ts`; it does not depend on a third-party CSV package.

## Format

The default header is:

```csv
asset,allocation_pct
XLM,60
USDC,40
```

Fields may be quoted, may contain the delimiter, and escape a literal quote as `""`. Both LF and CRLF records are supported, including when a CRLF or escaped quote is split across stream chunks. Blank trailing records are ignored.

Callers can provide a one-character delimiter and map external headers to the canonical `asset` and `allocation_pct` fields:

```ts
parseCsvText(csv, {
  delimiter: ';',
  headerMap: { symbol: 'asset', weight_pct: 'allocation_pct' },
})
```

## Large uploads

Use `parseCsvStream` or `buildAllocationsFromCsvStream` with an `AsyncIterable<string>` for large uploads. The state machine resumes quoted fields, escaped quotes, and record terminators across chunk boundaries, so it does not buffer the raw file or split it into an in-memory line array.

The allocation validator still enforces the service limit of 5,000 data rows and reports at most 100 detailed errors. This bounds application memory independently of upload size.

## Validation and errors

- The header must resolve both canonical fields.
- Asset cells must be non-empty and are normalized to uppercase.
- Allocation cells must be finite numbers between 0 and 100.
- Duplicate assets are combined before the portfolio total is checked.
- Allocations must total 100 percent, within the service tolerance.
- Unknown, disabled, or quarantined assets are rejected.

Parser coverage lives in `backend/src/test/portfolioImportService.test.ts` and includes quoted commas, escaped quotes, LF/CRLF input, blank records, missing values, non-numeric values, alternate delimiters, header mapping, and chunk-boundary cases.
