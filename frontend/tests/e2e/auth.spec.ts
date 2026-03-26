import { test, expect } from '@playwright/test';
import { connectMockWallet, E2E_UI_TIMEOUT } from './helpers';

test.describe('Authentication and Header', () => {
  test('should connect mock wallet successfully', async ({ page }) => {
    // Go to the main page
    await page.goto('/');

    // Ensure the title is correct
    await expect(page).toHaveTitle(/Stellar/i, { timeout: E2E_UI_TIMEOUT });

    await connectMockWallet(page);

    // After connecting, the header should display the truncated public key or disconnect options
    // The mocked key is GA2C5RFPE...M2OWH7 => "GA2C...OWH7" (in the dashboard header)
    const connectedAddress = page.getByText(/GA2C\.\.\.OWH7/i);
    await expect(connectedAddress).toBeVisible({ timeout: 10000 });
  });
});
