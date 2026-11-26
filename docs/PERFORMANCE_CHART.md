# Performance Chart States

This document describes how the Performance chart (`frontend/src/components/PerformanceChart.tsx`) behaves in its edge and failure states, how keyboard and screen-reader users move through them, and how it stays usable on narrow screens.

The detection logic lives in `frontend/src/utils/performanceChartState.ts`. User-facing text lives in `performanceChartCopy` in `frontend/src/content/uiCopy.ts`.

## States

The header (title, the visible **Range: …** label, the time range buttons and **Export**) stays on screen in every state except the "no portfolio / demo" placeholder. Changing range, retrying or loading never unmounts the controls, so the selected range is never lost.

| State | What the user sees | Recovery |
| --- | --- | --- |
| Loading | Skeleton in the chart area | n/a |
| Load failure | "Failed to load performance data", with a note that the range is kept | **Retry** refetches only the queries that failed. Picking another range also works. |
| Empty series | "No performance data available yet" | Export is disabled. Data appears as snapshots are captured. |
| Single price point | The point is drawn as a dot, with a note that there is no trend yet | Choose a longer range or check back later |
| Asset missing historical prices | An amber panel naming each asset and how many points lack a price. The chart still renders. | **Retry loading prices** refetches the analytics query. **Dismiss** hides the panel. |

### Missing historical prices

Each analytics snapshot carries per-asset `allocations`. An asset counts as missing history when it appears in the range but has no usable (finite) value in at least one snapshot. Snapshots with no `allocations` at all are ignored, so older data never raises a false warning.

Dismissing the panel leaves a compact **Missing data (n)** indicator in the header. It stays visible and reopens the panel. A dismissal applies only to the exact set of missing assets in the selected range: if the set changes, the panel comes back.

### No duplicate requests

Retry buttons are guarded by an in-flight flag and are disabled (`aria-busy="true"`, label "Retrying…") until the refetch settles. Repeated clicks or a held Enter key send a single request. A failed retry re-enables the button. The failure itself shows through the query's error state.

## Keyboard and screen readers

- Time range buttons are a labelled group (`Time range selector`). Each button has a spoken name ("Show 1 week") and `aria-pressed`.
- One polite live region (`role="status"`) announces the selected range and state, for example "3 data points for 1 week.", "One price point for 1 day.", "No performance data for 1 month.", "Performance data failed to load for 1 day. Retry is available." When prices are missing, it appends "Price history is missing for USDC."
- The chart has `role="img"` with a label that gives the range, the number of points and the first and last values, or the single value.
- The load failure uses `role="alert"`.
- Focus is never dropped onto the page body:
  - After a retry from the error state succeeds, the Retry button disappears and focus moves to the chart heading.
  - After **Dismiss**, focus moves to the **Missing data** indicator.
  - Activating the indicator moves focus to the reopened panel.
- Every control is a native `<button>`, reachable with Tab and operable with Enter or Space. **Dismiss** is the way to leave the missing-data flow.

## Narrow widths and large text

The range buttons, header and missing-data panel use `flex-wrap` / `min-w-0`, and text uses `break-words`. At 320px wide or with 200% text size, controls wrap onto new lines instead of clipping or forcing horizontal scroll. The **Range: …** label and the **Missing data** indicator stay visible.

To check this by hand, open the Analytics page:

1. In device emulation, set the width to 320px. Confirm that every range button, **Export**, the range label and the missing-data indicator or panel are visible and clickable without scrolling sideways.
2. Set the browser's text size to 200% and repeat.
3. Repeat in the empty, single-point, missing-prices and failure states. The component tests show how to reproduce each one with mocked query data.

## Tests

- `frontend/src/components/PerformanceChart.test.tsx` covers the empty series, a single price point, one asset missing prices, load failure and recovery, the selected range, the missing-data indicator, single-flight retries and focus handling. It uses isolated doubles for every data hook, so no request or wallet is involved.
- `frontend/src/utils/performanceChartState.test.ts` covers missing-history detection.
