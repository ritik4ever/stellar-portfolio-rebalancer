import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface A11yViolation {
  page: string;
  id: string;
  impact: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{
    html: string;
    target: string[];
    failureSummary: string;
  }>;
}

const MAIN_PAGES = ['/', '/compare', '/settings', '/public/share/demo-portfolio'];

const REPORT_DIR = join(process.cwd(), 'a11y-reports');

test.describe('Accessibility scans', () => {
  const allViolations: A11yViolation[] = [];

  for (const route of MAIN_PAGES) {
    test(`/${route === '/' ? 'landing' : route.replace(/\//g, '-').replace(/^-/, '')} has no critical or serious a11y violations`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .include('body')
        .analyze();

      const criticalOrSerious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      for (const violation of criticalOrSerious) {
        allViolations.push({
          page: route,
          id: violation.id,
          impact: violation.impact || 'unknown',
          description: violation.description,
          help: violation.help,
          helpUrl: violation.helpUrl,
          nodes: violation.nodes.map((n) => ({
            html: n.html.slice(0, 300),
            target: n.target as string[],
            failureSummary: n.failureSummary,
          })),
        });
      }

      expect(criticalOrSerious, `Accessibility violations on ${route}`).toEqual([]);
    });
  }

  test.afterAll(() => {
    if (allViolations.length > 0) {
      mkdirSync(REPORT_DIR, { recursive: true });
      const reportPath = join(REPORT_DIR, 'accessibility-report.json');
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            summary: {
              totalViolations: allViolations.length,
              pages: [...new Set(allViolations.map((v) => v.page))],
            },
            violations: allViolations,
          },
          null,
          2
        )
      );
      console.log(`Accessibility report written to ${reportPath}`);
    }
  });
});
