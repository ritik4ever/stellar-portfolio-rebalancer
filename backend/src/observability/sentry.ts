import * as Sentry from '@sentry/node'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import { observabilityConfig } from './config.js'
import { logger } from '../utils/logger.js'

let initialized = false

export function initializeSentry(): void {
    if (initialized || !observabilityConfig.sentry.enabled || !observabilityConfig.sentry.dsn) {
        return
    }

    Sentry.init({
        dsn: observabilityConfig.sentry.dsn,
        environment: observabilityConfig.sentry.environment,
        release: observabilityConfig.sentry.release,
        tracesSampleRate: observabilityConfig.sentry.tracesSampleRate,
        profilesSampleRate: observabilityConfig.sentry.profilesSampleRate,
        integrations: [nodeProfilingIntegration()],
        sendDefaultPii: false,
    })

    initialized = true
    logger.info('Sentry instrumentation enabled', {
        environment: observabilityConfig.sentry.environment,
        release: observabilityConfig.sentry.release || 'unversioned',
    })
}

export function captureException(error: unknown, context: Record<string, unknown> = {}): void {
    if (!initialized) return
    Sentry.withScope(scope => {
        for (const [key, value] of Object.entries(context)) {
            scope.setExtra(key, value)
        }
        Sentry.captureException(error)
    })
}

export function setupProcessErrorHandlers(): void {
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception', {
            error: error.message,
            stack: error.stack,
        })
        captureException(error, { source: 'uncaughtException' })
    })

    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled rejection', {
            reason: reason instanceof Error ? reason.message : String(reason),
        })
        captureException(reason, { source: 'unhandledRejection' })
    })
}

export { Sentry }
