import { expect, type Page } from '@playwright/test'

/** CI / cold Vite can be slow to hydrate; avoid default 5s timeouts on wallet UI. */
export const E2E_UI_TIMEOUT = 30_000

export async function connectMockWallet(page: Page) {
    // 1. Mark onboarding tour as completed so it does not intercept clicks
    await page.evaluate(() => {
        try {
            localStorage.setItem('onboarding-completed', '1')
        } catch {}
    }).catch(() => {})

    // 2. Dismiss onboarding tour if already visible on screen
    const dismissBtn = page.getByRole('button', { name: /Dismiss onboarding|Skip/i }).first()
    if (await dismissBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dismissBtn.click({ force: true }).catch(() => {})
    }

    // 3. Connect mock wallet
    const connect = page.getByRole('button', { name: /Connect Wallet/i }).first()
    await expect(connect).toBeVisible({ timeout: E2E_UI_TIMEOUT })
    await connect.click({ force: true })
    const mock = page.getByRole('button', { name: /Mock Wallet \(Test\)/i })
    await expect(mock).toBeVisible({ timeout: E2E_UI_TIMEOUT })
    await mock.click({ force: true })

    // 4. Dismiss onboarding tour if it appeared during connect
    if (await dismissBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dismissBtn.click({ force: true }).catch(() => {})
    }

    // 5. Accept consent modal if prompted for this session
    const acceptBtn = page.getByRole('button', { name: /Accept and continue/i })
    if (await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        const checkboxes = page.locator('input[type="checkbox"]')
        const count = await checkboxes.count()
        for (let i = 0; i < count; i++) {
            await checkboxes.nth(i).check({ force: true }).catch(() => {})
        }
        await acceptBtn.click({ force: true }).catch(() => {})
        await acceptBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
}
