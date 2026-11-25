import { test, expect, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page) {
  const overflowing = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
    .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
    .map((element) => `${element.tagName}.${element.className}`));
  expect(overflowing).toEqual([]);
}

for (const textScale of [100, 200]) {
  test(`DCA amount remains operable at 320px with ${textScale}% text`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await page.evaluate(async () => {
      const load = new Function('return import("/tests/e2e/fixtures/dca-wizard.tsx")');
      await load();
    });
    await page.addStyleTag({ content: `html { font-size: ${textScale}%; }` });
    await page.getByLabel(/rebalancing strategy/i).selectOption('dca');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^next/i }).click();

    const amount = page.getByLabel('DCA Amount');
    await amount.fill('123456789.1234567');
    await expect(amount).toHaveValue('123456789.1234567');
    await page.evaluate(async () => {
      const load = new Function('return import("/src/i18n/index.ts")');
      const { default: i18n } = await load();
      await i18n.changeLanguage('de');
    });
    await expect(page.getByText(/language changed while editing/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^next/i })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: /confirm amount/i }).click();
    await page.getByRole('button', { name: /^next/i }).click();
    await expect(page.getByText(/123456789\.1234567 every/)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign with freighter/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
