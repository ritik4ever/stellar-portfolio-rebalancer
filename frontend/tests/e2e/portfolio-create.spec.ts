import { test, expect } from '@playwright/test';

test.describe('Portfolio Creation Flow', () => {
  test('should create a new portfolio', async ({ page }) => {
    // 1. Visit landing and connect mock wallet
    await page.goto('/');
    await page.getByRole('button', { name: /Connect Wallet/i }).first().click();
    await page.getByRole('button', { name: /Mock Wallet \(Test\)/i }).click();

    // 2. Wait for dashboard redirect
    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 10000 });

    // 3. Navigate to portfolio setup
    await page.getByRole('button', { name: /Create Portfolio/i }).click();
    await expect(page.getByRole('heading', { name: /Create Portfolio/i })).toBeVisible();

    // 4. Test validation (Total > 100)
    // Initially has XLM at 40%. Let's update it to 105%.
    const percentageInputs = page.locator('input[type="number"]').first();
    await percentageInputs.fill('105');

    // The submit button should be disabled
    const submitBtn = page.getByRole('button', { name: /Create Portfolio/i }).last();
    await expect(submitBtn).toBeDisabled();

    // Check deviation message
    await expect(page.getByText(/5% over — reduce allocations/i)).toBeVisible();

    // 5. Use Preset Quick Start to get valid allocations
    await page.getByRole('button', { name: /Balanced/i }).click();

    // Now Total = 100, wait to verify message changes to success
    await expect(page.getByText(/Allocations sum to 100% ✓/i)).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // Intercept the API call to mock a successful response since the backend isn't running in this UI test
    await page.route('**/api/portfolio', async route => {
      await route.fulfill({ json: { success: true }, status: 200 });
    });

    // 6. Submit creation
    await submitBtn.click();

    // We should see a success banner
    await expect(page.getByText(/Portfolio created successfully/i)).toBeVisible();

    // 7. Should redirect back to dashboard
    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 5000 });
  });
});
