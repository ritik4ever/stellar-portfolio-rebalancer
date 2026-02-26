import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'lcov', 'html'],
            include: [
                'src/utils/apiResponse.ts',
                'src/utils/apiErrors.ts',
                'src/middleware/**/*.ts',
                'src/services/databaseService.ts',
                'src/services/rebalanceHistory.ts',
                'src/services/rebalanceLock.ts',
                'src/db/idempotencyDb.ts',
                'src/utils/decimal.ts'
            ],
            exclude: [
                'src/test/**'
            ],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80
            }
        }
    }
})
