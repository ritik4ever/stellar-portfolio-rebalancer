import { test, expect } from '@playwright/test';
import { connectMockWallet } from '../e2e/helpers';

test.describe('Visual Regression - Portfolio Creation', () => {
  test('portfolio setup page with allocations', async ({ page }) => {
    await page.goto('/');
    await connectMockWallet(page);

    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /Create Portfolio/i }).click();
    await expect(page.getByRole('heading', { name: /Create Portfolio/i })).toBeVisible({ timeout: 10000 });

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('portfolio-creation-setup.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('portfolio setup after preset selection', async ({ page }) => {
    await page.goto('/');
    await connectMockWallet(page);

    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /Create Portfolio/i }).click();
    await expect(page.getByRole('heading', { name: /Create Portfolio/i })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /Balanced/i }).click();
    await expect(page.getByText(/Allocations sum to 100% ✓/i)).toBeVisible({ timeout: 5000 });

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('portfolio-creation-preset.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
