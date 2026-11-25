import { expect, test } from '@playwright/test'

test('wallet selection remains usable at 320px with enlarged text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  await page.getByRole('button', { name: 'Connect Wallet' }).first().click()

  const dialog = page.getByRole('dialog', { name: 'Select Wallet' })
  await expect(dialog).toBeVisible()

  const dimensions = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowY: getComputedStyle(element).overflowY,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  expect(dimensions.overflowY).toBe('auto')

  const firstWallet = dialog.getByRole('button', { name: 'Connect to Freighter' })
  await expect(firstWallet).toBeFocused()
  await firstWallet.scrollIntoViewIfNeeded()
  const walletBounds = await firstWallet.boundingBox()
  if (!walletBounds) throw new Error('Wallet action has no visible bounds')
  expect(walletBounds.x).toBeGreaterThanOrEqual(0)
  expect(walletBounds.x + walletBounds.width).toBeLessThanOrEqual(320)

  const reconnectSwitch = dialog.getByRole('switch', { name: 'Auto-reconnect on page refresh' })
  await reconnectSwitch.scrollIntoViewIfNeeded()
  await reconnectSwitch.click()
  await expect(reconnectSwitch).toHaveAttribute('aria-checked', 'false')
})
