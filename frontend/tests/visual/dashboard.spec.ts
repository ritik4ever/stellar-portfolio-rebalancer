import { test, expect } from '@playwright/test';
import { connectMockWallet } from '../e2e/helpers';

test.describe('Visual Regression - Dashboard', () => {
  test('dashboard overview page after wallet connect', async ({ page }) => {
    await page.goto('/');
    await connectMockWallet(page);

    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 15000 });

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('dashboard-overview.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('dashboard analytics tab', async ({ page }) => {
    await page.goto('/');
    await connectMockWallet(page);

    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 15000 });

    const analyticsTab = page.getByRole('button', { name: /Analytics/i });
    await expect(analyticsTab).toBeVisible({ timeout: 10000 });
    await analyticsTab.click();

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('dashboard-analytics.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
