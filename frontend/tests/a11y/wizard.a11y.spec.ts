import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { connectMockWallet, E2E_UI_TIMEOUT } from '../e2e/helpers';

async function runAxeScan(page: Page, stepName: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include('body')
    .analyze();

  const criticalOrSerious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious'
  );

  expect(criticalOrSerious, `Accessibility violations on ${stepName}`).toEqual([]);
}

test.describe('PortfolioWizard Accessibility & Keyboard Flow', () => {
  test('keyboard navigates through the wizard and passes a11y scans', async ({ page }) => {
    // Navigate to app and connect the mock wallet
    await page.goto('/');
    await connectMockWallet(page);

    // Wait for the dashboard to load
    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: E2E_UI_TIMEOUT });

    // Open Wizard using keyboard
    const wizardBtn = page.getByRole('button', { name: /✨ Wizard/i });
    await wizardBtn.focus();
    await page.keyboard.press('Enter');

    // --- STEP 1: Select Template ---
    await expect(page.getByRole('heading', { name: /Step 1: Choose a Template/i })).toBeVisible();
    await runAxeScan(page, 'Wizard Step 1');

    // Use keyboard to click "Next"
    const nextBtn = page.getByRole('button', { name: /Next/i });
    await nextBtn.focus();
    await page.keyboard.press('Enter');

    // --- STEP 2: Set Allocations ---
    await expect(page.getByRole('heading', { name: /Step 2: Add Assets/i })).toBeVisible();
    await runAxeScan(page, 'Wizard Step 2');

    await nextBtn.focus();
    await page.keyboard.press('Enter');

    // --- STEP 3: Configure Rules ---
    await expect(page.getByRole('heading', { name: /Step 3: Configure Automation Rules/i })).toBeVisible();
    await runAxeScan(page, 'Wizard Step 3');

    await nextBtn.focus();
    await page.keyboard.press('Enter');

    // --- STEP 4: Review & Sign ---
    await expect(page.getByRole('heading', { name: /Step 4: Review & Sign/i })).toBeVisible();
    await runAxeScan(page, 'Wizard Step 4');

    // Mock the portfolio creation endpoint
    await page.route('**/api/v1/portfolio', async route => {
      await route.fulfill({ 
        json: { id: 'a11y-test-portfolio', allocations: { XLM: 100 } }, 
        status: 200 
      });
    });

    // Mock the share endpoint
    await page.route('**/api/v1/portfolio/*/share', async route => {
      await route.fulfill({
        json: { hash: 'a11y-share-hash', active: true },
        status: 200
      });
    });

    // Keyboard activate "Sign with Freighter"
    const signBtn = page.getByRole('button', { name: /Sign with Freighter/i });
    await signBtn.focus();
    await page.keyboard.press('Enter');

    // --- STEP 5: Success ---
    await expect(page.getByRole('heading', { name: /Portfolio Created Successfully!/i })).toBeVisible({ timeout: 10000 });
    await runAxeScan(page, 'Wizard Step 5');
    
    // Finish by navigating to dashboard with keyboard
    const goDashboardBtn = page.getByRole('button', { name: /Go to Dashboard/i });
    await goDashboardBtn.focus();
    await page.keyboard.press('Enter');
    
    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 5000 });
  });
});
