import { expect, type Page } from '@playwright/test'

/** CI / cold Vite can be slow to hydrate; avoid default 5s timeouts on wallet UI. */
export const E2E_UI_TIMEOUT = 30_000

export async function connectMockWallet(page: Page) {
    const connect = page.getByRole('button', { name: /Connect Wallet/i }).first()
    await expect(connect).toBeVisible({ timeout: E2E_UI_TIMEOUT })
    await connect.click()
    const mock = page.getByRole('button', { name: /Mock Wallet \(Test\)/i })
    await expect(mock).toBeVisible({ timeout: E2E_UI_TIMEOUT })
    await mock.click()

    // Accept consent modal if prompted for this session
    const acceptBtn = page.getByRole('button', { name: /Accept and continue/i })
    if (await acceptBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const checkboxes = page.locator('input[type="checkbox"]')
        const count = await checkboxes.count()
        for (let i = 0; i < count; i++) {
            if (!(await checkboxes.nth(i).isChecked())) {
                await checkboxes.nth(i).check().catch(() => {})
            }
        }
        await acceptBtn.click().catch(() => {})
    }
}