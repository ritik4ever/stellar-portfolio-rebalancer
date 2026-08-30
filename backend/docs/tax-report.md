# Tax Report

`GET /api/v1/portfolio/tax-report`

Realized gain/loss report derived from completed rebalance events. Every rebalance is
treated as a sale of `fromAsset` and a purchase of `toAsset`; each purchase opens a tax
lot and each sale consumes lots according to the selected cost-basis method.

## Query parameters

| Param             | Values                     | Default        | Notes |
| ----------------- | -------------------------- | -------------- | ----- |
| `year`            | 2000–2100                  | current year   | Tax year to report on |
| `costBasisMethod` | `fifo`, `lifo`, `hifo`     | `fifo`         | Case-insensitive; unknown values return 400 |
| `format`          | `json`, `csv`, `turbotax`  | `json`         | |

## Cost-basis methods

| Method | Lot consumed first | Typical effect |
| ------ | ------------------ | -------------- |
| `fifo` | Oldest acquisition | Default; preserves the historical behaviour of this endpoint |
| `lifo` | Newest acquisition | Often defers gains in a rising market |
| `hifo` | Highest unit cost  | Minimises realized gains |

Ties in HIFO are broken toward the earlier lot so results are deterministic. A sale
larger than a single lot is split across as many lots as needed, and a sale with no
remaining basis is reported with a cost basis of zero.

Lot prices come from the price snapshot as of the trade date
(`databaseService.getPriceSnapshotAsOf`), falling back to the latest snapshot and then
to a static table, so lots retain their acquisition-date price.

## JSON response

```jsonc
{
  "taxYear": 2025,
  "costBasisMethod": "hifo",
  "totalRealizedGainLoss": -50,
  "totalTrades": 8,
  "entries": [ /* one buy + one sell per rebalance */ ],
  "disposals": [ /* one row per disposed lot: acquiredDate, soldDate, costBasis, proceeds */ ],
  "methodology": "HIFO (highest-in, first-out). …"
}
```

`disposals` is the lot-level view: one entry per matched lot, which is the granularity
consumer tax software needs because each disposal carries its own acquisition date.

## CSV exports

`format=csv` returns the internal ledger export
(`asset, date, type, amount, price, cost_basis, realized_gain_loss`).

`format=turbotax` returns a TurboTax-importable CSV, one row per disposed lot, with the
documented TurboTax cryptocurrency import columns in this exact order:

```
Currency Name,Purchase Date,Cost Basis,Date Sold,Proceeds
XLM,01/01/2025,400.00,06/01/2025,550.00
```

- Dates are `MM/DD/YYYY` in UTC.
- Monetary values are plain 2-decimal numbers — no currency symbol, no thousands separators.
- Asset names containing a comma or quote are quoted per RFC 4180.
- With no disposals the response is the header row alone, which TurboTax accepts as an
  empty import.

The selected `costBasisMethod` applies to the TurboTax export too, and is reflected in
the download filename (`turbotax-tax-report-<year>-<method>.csv`).
