import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/test/**/*.test.ts'],
        exclude: ['src/test/api.integration.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'lcov', 'html'],
            include: [
                'src/utils/apiResponse.ts',
                'src/utils/apiErrors.ts',
                'src/middleware/apiErrorHandler.ts',
                'src/middleware/auth.ts',
                'src/middleware/debugGate.ts',
                'src/middleware/idempotency.ts',
                'src/middleware/validate.ts',
                'src/db/idempotencyDb.ts'
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
