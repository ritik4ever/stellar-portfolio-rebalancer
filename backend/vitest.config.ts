import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/test/**/*.test.ts'],
        exclude: [
            'src/test/api.integration.test.ts',
            'src/test/apiPathCompatibility.integration.test.ts',
            'src/test/assets.routes.integration.test.ts',
            'src/test/consentPrivacy.integration.test.ts',
            'src/test/contractEventIndexer.test.ts',
            'src/test/contractEvents.test.ts',
            'src/test/databaseService.test.ts',
            'src/test/demoSession.test.ts',
            'src/test/featureFlags.test.ts',
            'src/test/healthProbeBypass.test.ts',
            'src/test/idempotency.test.ts',
            'src/test/legacyDeprecation.test.ts',
            'src/test/market.routes.integration.test.ts',
            'src/test/metrics.test.ts',
            'src/test/migration-manifest.test.ts',
            'src/test/notificationService.test.ts',
            'src/test/notifications.routes.integration.test.ts',
            'src/test/portfolioExport.integration.test.ts',
            'src/test/portfolios.routes.integration.test.ts',
            'src/test/preferences.test.ts',
            'src/test/priceHistory.test.ts',
            'src/test/queue.test.ts',
            'src/test/rateLimitMonitor.test.ts',
            'src/test/readiness.test.ts',
            'src/test/rebalanceDryRun.routes.test.ts',
            'src/test/rebalanceHistory.routes.test.ts',
            'src/test/rebalancing.routes.integration.test.ts',
            'src/test/reflector.service.test.ts',
            'src/test/requireJwt.test.ts',
            'src/test/revokeDeviceSession.test.ts',
            'src/test/notificationDelivery.test.ts',
        ],
        /** SQLite temp files + singleton DB modules: sequential files avoid EBUSY flakes on Windows/CI. */
        fileParallelism: false,
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
                lines: 0,
                functions: 0,
                branches: 0
            }
        }
    }
})
