import { test, expect } from '@playwright/test';

test.describe('Visual Regression - Components', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the visual test components page
    await page.goto('/visual-test-components');
    await page.waitForLoadState('networkidle');
  });

  test('DriftGauge - Light Theme', async ({ page }) => {
    const driftGaugeSection = page.locator('#drift-gauge-test');
    await expect(driftGaugeSection).toBeVisible();
    await expect(driftGaugeSection).toHaveScreenshot('drift-gauge-light.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('DriftGauge - Dark Theme', async ({ page }) => {
    // Enable dark theme
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    
    const driftGaugeSection = page.locator('#drift-gauge-test');
    await expect(driftGaugeSection).toBeVisible();
    await expect(driftGaugeSection).toHaveScreenshot('drift-gauge-dark.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('CorrelationHeatmap - Light Theme', async ({ page }) => {
    const heatmapSection = page.locator('#correlation-heatmap-test');
    await expect(heatmapSection).toBeVisible();
    await expect(heatmapSection).toHaveScreenshot('correlation-heatmap-light.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('CorrelationHeatmap - Dark Theme', async ({ page }) => {
    // Enable dark theme
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    
    const heatmapSection = page.locator('#correlation-heatmap-test');
    await expect(heatmapSection).toBeVisible();
    await expect(heatmapSection).toHaveScreenshot('correlation-heatmap-dark.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
