import { test, expect } from '@playwright/test';
import { connectMockWallet } from '../e2e/helpers';

test.describe('Visual Regression - Rebalance History', () => {
  test('rebalance history section on dashboard', async ({ page }) => {
    await page.goto('/');
    await connectMockWallet(page);

    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 15000 });

    const historyHeading = page.getByRole('heading', { name: /Rebalance History/i });
    await expect(historyHeading).toBeVisible({ timeout: 10000 });

    await historyHeading.scrollIntoViewIfNeeded();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('rebalance-history-dashboard.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('rebalance confirm modal', async ({ page }) => {
    await page.goto('/');
    await connectMockWallet(page);

    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 15000 });

    const executeBtn = page.getByRole('button', { name: /Review rebalance/i });
    if (await executeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await executeBtn.click();

      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('rebalance-confirm-modal.png', {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      });
    }
  });
});
