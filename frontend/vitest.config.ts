import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['tests/e2e/**', '**/node_modules/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'lcov', 'html'],
            include: ['src/utils/calculations.ts'],
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 70
            }
        }
    }
})
