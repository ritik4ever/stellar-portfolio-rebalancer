import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
