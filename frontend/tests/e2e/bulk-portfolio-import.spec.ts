/**
 * E2E tests for BulkPortfolioImport component.
 *
 * Issue: #1527 [TEST] Add e2e test for bulk import happy/error paths
 *
 * Covers:
 *   - Happy path: valid CSV upload → success response → dashboard redirect
 *   - Error path: CSV with per-row validation errors → inline error UI
 *   - Error path: CSV whose allocations don't sum to 100% → top-level error
 */

import { test, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { connectMockWallet, E2E_UI_TIMEOUT } from './helpers'

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURES_DIR = path.join(__dirname, 'fixtures')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to Portfolio Setup from the landing page and click the Bulk Import tab. */
async function goToBulkImportTab(page: import('@playwright/test').Page) {
  await page.goto('/')
  await connectMockWallet(page)

  await expect(
    page.getByRole('heading', { name: /Portfolio Dashboard/i }),
  ).toBeVisible({ timeout: E2E_UI_TIMEOUT })

  // Open Portfolio Setup
  await page.getByRole('button', { name: /Create Portfolio/i }).click()
  await expect(
    page.getByRole('heading', { name: /^Create Portfolio$/i }),
  ).toBeVisible({ timeout: E2E_UI_TIMEOUT })

  // Switch to Bulk Import tab
  await page.getByRole('button', { name: /Bulk Import/i }).click()

  // Heading inside the component confirms we landed on it
  await expect(
    page.getByRole('heading', { name: /Bulk Import Allocations/i }),
  ).toBeVisible({ timeout: E2E_UI_TIMEOUT })
}

// ---------------------------------------------------------------------------
// Suite 1 – Happy path
// ---------------------------------------------------------------------------

test.describe('BulkPortfolioImport – happy path', () => {
  test('valid CSV upload completes import and redirects to dashboard', async ({
    page,
  }) => {
    // Intercept the import API call and return a synthetic success response.
    await page.route('**/api/v1/portfolio/import', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { portfolioId: 'e2e-test-portfolio-id-valid', status: 'created' },
          error: null,
          timestamp: new Date().toISOString(),
        }),
      })
    })

    await goToBulkImportTab(page)

    // Upload the valid CSV fixture
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'valid-portfolio.csv'))

    // File name preview should be visible
    await expect(page.getByText(/valid-portfolio\.csv/i)).toBeVisible()

    // The CSV preview section should appear
    await expect(page.getByText(/Preview/i)).toBeVisible()

    // Click Import
    await page.getByRole('button', { name: /^Import$/i }).click()

    // Assert no error alert is shown
    await expect(page.locator('[role="alert"]')).not.toBeVisible()

    // After success the component calls onImported and the page navigates back to
    // the dashboard (PortfolioSetup sets success=true then calls onNavigate('dashboard')).
    await expect(
      page.getByRole('heading', { name: /Portfolio Dashboard/i }),
    ).toBeVisible({ timeout: E2E_UI_TIMEOUT })
  })

  test('Import button is disabled when no file is selected', async ({ page }) => {
    await goToBulkImportTab(page)

    // No file selected → button must be disabled
    const importBtn = page.getByRole('button', { name: /^Import$/i })
    await expect(importBtn).toBeDisabled()
  })

  test('CSV preview appears after file is selected', async ({ page }) => {
    await goToBulkImportTab(page)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'valid-portfolio.csv'))

    // The component renders a preview box with the file content
    await expect(page.getByText(/Preview/i)).toBeVisible()

    // Verify the file name indicator
    await expect(page.getByText(/valid-portfolio\.csv/i)).toBeVisible()

    // Import button should be enabled once a file is chosen
    const importBtn = page.getByRole('button', { name: /^Import$/i })
    await expect(importBtn).toBeEnabled()
  })
})

// ---------------------------------------------------------------------------
// Suite 2 – Validation error paths
// ---------------------------------------------------------------------------

test.describe('BulkPortfolioImport – validation error paths', () => {
  test('inline row errors surface for a CSV with non-numeric allocation_pct', async ({
    page,
  }) => {
    // Intercept the import API and return a VALIDATION_ERROR with per-row detail.
    await page.route('**/api/v1/portfolio/import', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: {
            error: 'VALIDATION_ERROR',
            message: 'Bulk import validation failed',
            errors: [
              {
                row: 3,
                field: 'allocation_pct',
                message: 'allocation_pct must be a number',
              },
            ],
            meta: { totalRows: 3, validRows: 2 },
          },
          timestamp: new Date().toISOString(),
        }),
      })
    })

    await goToBulkImportTab(page)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(
      path.join(FIXTURES_DIR, 'row-errors-portfolio.csv'),
    )

    await page.getByRole('button', { name: /^Import$/i }).click()

    // Top-level error alert should be visible
    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible({ timeout: E2E_UI_TIMEOUT })
    await expect(alert).toContainText(/validation failed|import failed/i)

    // "Validation details" section with per-row errors
    await expect(
      page.getByRole('heading', { name: /Validation details/i }),
    ).toBeVisible()

    // Row 3 error entry should appear
    await expect(page.getByText(/row 3/i)).toBeVisible()
    await expect(page.getByText(/allocation_pct/i)).toBeVisible()
    await expect(page.getByText(/must be a number/i)).toBeVisible()
  })

  test('top-level error when allocations do not sum to 100%', async ({
    page,
  }) => {
    // Intercept the import API and return a sum-validation error.
    await page.route('**/api/v1/portfolio/import', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: {
            error: 'VALIDATION_ERROR',
            message: 'Bulk import validation failed',
            errors: [
              {
                row: 0,
                field: 'allocation_pct',
                message: 'Allocations must sum to 100% (received 100%)',
              },
            ],
            meta: { totalRows: 4, validRows: 3 },
          },
          timestamp: new Date().toISOString(),
        }),
      })
    })

    await goToBulkImportTab(page)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(
      path.join(FIXTURES_DIR, 'invalid-portfolio.csv'),
    )

    await page.getByRole('button', { name: /^Import$/i }).click()

    // Top-level error alert must be visible
    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible({ timeout: E2E_UI_TIMEOUT })
    await expect(alert).toContainText(/validation failed|import failed/i)

    // Row stats (valid/total) should be surfaced
    await expect(page.getByText(/3 valid.*4 total|3.*valid.*4.*total/i)).toBeVisible()
  })

  test('shows generic error message when backend returns a 500', async ({
    page,
  }) => {
    await page.route('**/api/v1/portfolio/import', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: {
            error: 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
          timestamp: new Date().toISOString(),
        }),
      })
    })

    await goToBulkImportTab(page)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'valid-portfolio.csv'))

    await page.getByRole('button', { name: /^Import$/i }).click()

    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible({ timeout: E2E_UI_TIMEOUT })
    // The component shows err?.message or 'Import failed'
    await expect(alert).toContainText(/import failed|internal server error/i)
  })

  test('Import button shows busy state while request is in-flight', async ({
    page,
  }) => {
    let resolveRequest!: () => void

    // Delay the response so we can observe the loading state.
    await page.route('**/api/v1/portfolio/import', async (route) => {
      await new Promise<void>((resolve) => {
        resolveRequest = resolve
      })
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { portfolioId: 'e2e-busy-test', status: 'created' },
          error: null,
          timestamp: new Date().toISOString(),
        }),
      })
    })

    await goToBulkImportTab(page)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'valid-portfolio.csv'))

    const importBtn = page.getByRole('button', { name: /^Import$/i })
    await importBtn.click()

    // While the request is pending the button text changes to "Importing…"
    await expect(
      page.getByRole('button', { name: /Importing…/i }),
    ).toBeVisible()

    // Release the in-flight request
    resolveRequest()

    // After the response lands we navigate away – the dashboard heading reappears.
    await expect(
      page.getByRole('heading', { name: /Portfolio Dashboard/i }),
    ).toBeVisible({ timeout: E2E_UI_TIMEOUT })
  })
})
