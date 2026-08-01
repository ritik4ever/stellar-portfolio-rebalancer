# Visual Regression Testing

This directory contains visual regression tests for the frontend using Playwright. 
We take snapshots of pages and specific components (like `DriftGauge` and `CorrelationHeatmap`) across different themes to ensure UI consistency.

## Running Tests

To run the visual regression tests and compare against the current baselines:

```bash
npm run test:e2e:visual
```

## Updating Snapshots

When you intentionally make a visual change to a component or page, the visual regression tests will fail. To update the baseline snapshots to match your new changes, run:

```bash
npm run test:e2e:visual-update
```

This will overwrite the existing baseline images in the `baselines` directory. You should review the git diff for these images to ensure only the expected changes were captured before committing them.
