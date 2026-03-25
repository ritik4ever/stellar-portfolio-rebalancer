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
}
