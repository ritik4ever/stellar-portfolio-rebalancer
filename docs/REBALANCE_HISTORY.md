# Rebalance history: narrow widths and large text

The rebalance history section (`frontend/src/components/RebalanceHistory.tsx`)
is used at every viewport the dashboard supports. This note records the layout
contract that keeps it usable at **320px** and with **200% text sizing**
(SPR-2026-054, issue #1978).

## What stays visible

- **Header controls:** `Export CSV`, the retry/dismiss error actions and the
  section title wrap onto separate lines. Controls use `flex-wrap` and
  `min-w-0`, so no button is pushed outside the card.
- **Event rows:** each event is a column below `sm` and a row above it. Trigger
  text, risk/source badges and the date/time line wrap instead of forcing
  horizontal scroll.
- **Trade amounts:** `Amount: $…`, trade counts, gas, slippage and the
  from/to asset badges remain rendered in full. They use `break-words` and
  `min-w-0` rather than truncation, so a long trigger or a large amount never
  hides the numbers.
- **Event order:** rows are rendered in the API order (which is stable for
  events sharing a timestamp) and keyed by `event.id`. Sorting or filtering is
  never applied implicitly.
- **Pagination:** only a window of pages is rendered (first, last and the
  current page ±1) with an ellipsis for skipped ranges. This avoids 25 page
  buttons overflowing the card at 320px. Previous/next arrows keep their
  accessible names and disabled states.

## Automated coverage

`RebalanceHistory.responsive.test.tsx` asserts the structural contract and
drives every control while the root font size is set to `200%`:

```bash
cd frontend
npx vitest run src/components/RebalanceHistory.responsive.test.tsx
```

It complements `RebalanceHistory.a11y.test.tsx` (accessible names, focus and
announcements) and `RebalanceHistory.edge.test.tsx` (stable order, amounts and
failure isolation).

## Manual check

1. Open the dashboard at a 320px viewport (device emulation) with a portfolio
   that has at least 20 history entries.
2. Confirm the export button, error retry/dismiss actions and pagination
   (including the page window and ellipsis) are reachable without sideways
   scrolling.
3. Confirm each event still shows its trade count, `Amount: $…`, gas and the
   from/to assets, and that two events with the same timestamp keep their order.
4. Set the browser text size to 200% and repeat. Nothing should clip, overlap
   or require horizontal scrolling.
