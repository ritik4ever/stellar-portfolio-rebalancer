import { test, expect } from '@playwright/test';

test.describe('Authentication and Header', () => {
  test('should connect mock wallet successfully', async ({ page }) => {
    // Go to the main page
    await page.goto('/');

    // Ensure the title is correct
    await expect(page).toHaveTitle(/Stellar/i);

    // Look for the "Connect Wallet" button
    const connectButton = page.getByRole('button', { name: /Connect Wallet/i }).first();
    await expect(connectButton).toBeVisible();

    // Click to open wallet modal
    await connectButton.click();

    // With VITE_E2E_MOCK_WALLET=true, we should see "Mock Wallet (Test)"
    const mockWalletOption = page.getByRole('button', { name: /Mock Wallet \(Test\)/i });
    await expect(mockWalletOption).toBeVisible();

    // Click mock wallet
    await mockWalletOption.click();

    // After connecting, the header should display the truncated public key or disconnect options
    // The mocked key is GA2C5RFPE...M2OWH7 => "GA2C...OWH7" (in the dashboard header)
    const connectedAddress = page.getByText(/GA2C\.\.\.OWH7/i);
    await expect(connectedAddress).toBeVisible({ timeout: 10000 });
  });
});
