import { defineConfig } from 'vitest/config'

const shardArg = process.argv.find(a => a.startsWith('--shard'))
const shardSuffix = shardArg ? shardArg.replace(/^--shard=?/, '').replace('/', '-') : '1-1'

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/test/**/*.test.ts'],
        exclude: ['src/test/api.integration.test.ts'],
        /** SQLite temp files + singleton DB modules: sequential files avoid EBUSY flakes on Windows/CI. */
        fileParallelism: false,
        outputFile: {
            blob: `.vitest-reports/blob-${shardSuffix}.json`
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'lcov', 'html'],
            include: [
                'src/utils/apiResponse.ts',
                'src/utils/apiErrors.ts',
                'src/utils/errorSanitizer.ts',
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
            thresholds: process.argv.some(a => a.startsWith('--shard')) ? undefined : {
                lines: 80,
                functions: 80,
                branches: 80
            }
        }
    }
})
