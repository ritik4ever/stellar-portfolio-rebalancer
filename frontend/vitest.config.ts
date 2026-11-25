import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dirname = path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addonexport default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      include: [
        'src/utils/calculations.ts',
        'src/components/**/*.{ts,tsx}',
        'src/hooks/**/*.{ts,tsx}'
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70
      }
    },
    projects: [{
      extends: true,
      test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['tests/e2e/**', '**/node_modules/**']
      }
    }]
  }
});