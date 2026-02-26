import { test, expect } from '@playwright/test'

test.describe('Notification preferences flow', () => {
  test('loads preferences and saves updates deterministically', async ({ page }) => {
    await page.route('**/api/notifications/preferences**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            preferences: {
              emailEnabled: false,
              emailAddress: '',
              webhookEnabled: false,
              webhookUrl: '',
              events: {
                rebalance: true,
                circuitBreaker: true,
                priceMovement: true,
                riskChange: true
              }
            }
          },
          error: null,
          timestamp: new Date().toISOString()
        })
      })
    })

    await page.route('**/api/notifications/subscribe', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { ok: true },
          error: null,
          timestamp: new Date().toISOString()
        })
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Connect Wallet/i }).first().click()
    await page.getByRole('button', { name: /Mock Wallet \(Test\)/i }).click()

    await expect(page.getByRole('heading', { name: /Portfolio Dashboard/i })).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /Notifications/i }).click()

    await expect(page.getByRole('heading', { name: /^Notifications$/i })).toBeVisible()

    await page.locator('div:has-text("Email Notifications") button').first().click()
    await page.getByPlaceholder('your-email@example.com').fill('e2e@example.com')

    const saveButton = page.getByRole('button', { name: /Save Preferences/i })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()

    await expect(page.getByText(/Preferences saved successfully/i)).toBeVisible()
  })
})
