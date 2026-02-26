import { test, expect } from '@playwright/test'

test.describe('Portfolio validation edge cases', () => {
  test('shows under/over allocation validation and enables submit when balanced', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).first().click()
    await page.getByRole('button', { name: /Mock Wallet \(Test\)/i }).click()

    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /Create Portfolio/i }).click()

    await expect(page.getByRole('heading', { name: /^Create Portfolio$/i })).toBeVisible()

    const input = page.locator('input[type="number"]').first()
    const submit = page.getByRole('button', { name: /Create Portfolio/i }).last()

    await input.fill('95')
    await expect(page.getByText(/under — add/i)).toBeVisible()
    await expect(submit).toBeDisabled()

    await input.fill('105')
    await expect(page.getByText(/over — reduce allocations/i)).toBeVisible()
    await expect(submit).toBeDisabled()

    await page.getByRole('button', { name: /Balanced/i }).click()
    await expect(page.getByText(/Allocations sum to 100%/i)).toBeVisible()
    await expect(submit).toBeEnabled()
  })
})
