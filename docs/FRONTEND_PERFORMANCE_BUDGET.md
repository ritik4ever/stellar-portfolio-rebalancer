# Frontend Lighthouse performance budget

The `Lighthouse CI` workflow builds the frontend production bundle for each pull request that changes frontend code, the Lighthouse configuration, the workflow itself, or this document. It runs Lighthouse CI against `frontend/dist` and uploads the generated reports as the `lighthouse-report` CI artifact.

## Current enforced thresholds

The source of truth is `.lighthouserc.json`:

| Budget | Threshold | Enforced as (`ci.assert.assertions`) | Why it matters |
| --- | ---: | --- | --- |
| JavaScript resource size | 450 KiB | `resource-summary:script:size` (`maxNumericValue: 460800` bytes) | Keeps the interactive bundle small enough for slower devices. |
| Total page resource size | 650 KiB | `resource-summary:total:size` (`maxNumericValue: 665600` bytes) | Limits aggregate payload growth across scripts, styles, images, and fonts. |
| Largest Contentful Paint (LCP) | 2,500 ms | `largest-contentful-paint` | Preserves fast perceived loading for the main dashboard content. |
| Total Blocking Time (TBT) | 200 ms | `total-blocking-time` | Prevents long main-thread blocks that make controls feel unresponsive. |
| Cumulative Layout Shift (CLS) | 0.1 | `cumulative-layout-shift` | Prevents visible layout jumps while the page loads. |

## Why size budgets use `resource-summary` assertions

Lighthouse 12 removed the native budgets feature (`settings.budgets` / `budgetPath` and the `performance-budget` audit), and this workflow pins `treosh/lighthouse-ci-action@v12`, which bundles `@lhci/cli@0.15` → `lighthouse@12.6.1`. The supported replacement is Lighthouse CI's `resource-summary:<resourceType>:(size|count)` assertion, which is evaluated against the `resource-summary` audit that still ships with Lighthouse.

Note the unit difference: `resource-summary` assertions take `maxNumericValue` in **bytes**, while the previous `budget.json` style values were in **KiB**. The byte values are therefore `KiB × 1024` (450 × 1024 = 460800, 650 × 1024 = 665600).

The sizes are measured as transfer size. The Lighthouse CI static server gzips responses, so the enforced numbers track the compressed payload; the current production build transfers roughly 397 KiB of JavaScript and roughly 410 KiB in total before third-party fonts.

## Adjusting the budget

Budget changes should be rare and reviewed as product/performance tradeoffs:

1. Run `cd frontend && npm run build` locally and inspect the Lighthouse report from CI or a local LHCI run.
2. Explain the intentional tradeoff in the pull request body, including which user-facing improvement requires the larger budget.
3. Update the matching assertion in `.lighthouserc.json` (remember `resource-summary` sizes are in bytes, so KiB × 1024) with the smallest threshold increase that covers the measured change.
4. Update the table above in the same pull request so reviewers can compare the documented and enforced limits.
5. Include any follow-up optimization issue in the PR if the increase is temporary.

A pull request that exceeds the configured budget should fail CI until the regression is optimized or the budget change is explicitly reviewed.
