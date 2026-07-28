# Frontend Lighthouse performance budget

The `Lighthouse CI` workflow builds the frontend preview bundle for each pull request that changes frontend code, the Lighthouse configuration, or this document. It runs Lighthouse CI against `frontend/dist` and uploads the generated reports as the `lighthouse-report` CI artifact.

## Current enforced thresholds

The source of truth is `.lighthouserc.json`:

| Budget | Threshold | Why it matters |
| --- | ---: | --- |
| JavaScript resource size | 300 KiB | Keeps the interactive bundle small enough for slower devices. |
| Total page resource size | 650 KiB | Limits aggregate payload growth across scripts, styles, images, and fonts. |
| Largest Contentful Paint (LCP) | 2,500 ms | Preserves fast perceived loading for the main dashboard content. |
| Total Blocking Time (TBT) | 200 ms | Prevents long main-thread blocks that make controls feel unresponsive. |
| Cumulative Layout Shift (CLS) | 0.1 | Prevents visible layout jumps while the page loads. |

## Adjusting the budget

Budget changes should be rare and reviewed as product/performance tradeoffs:

1. Run `cd frontend && npm run build` locally and inspect the Lighthouse report from CI or a local LHCI run.
2. Explain the intentional tradeoff in the pull request body, including which user-facing improvement requires the larger budget.
3. Update `.lighthouserc.json` with the smallest threshold increase that covers the measured change.
4. Update the table above in the same pull request so reviewers can compare the documented and enforced limits.
5. Include any follow-up optimization issue in the PR if the increase is temporary.

A pull request that exceeds the configured budget should fail CI until the regression is optimized or the budget change is explicitly reviewed.
