import * as Sentry from '@sentry/react'

const enabled = import.meta.env.VITE_SENTRY_ENABLED === 'true' && !!import.meta.env.VITE_SENTRY_DSN

const pickFirstDefined = (...values: Array<string | undefined>): string | undefined => {
    for (const value of values) {
        if (value == null) continue
        const trimmed = value.trim()
        if (trimmed !== '') return trimmed
    }
    return undefined
}

export function initializeObservability(): void {
    if (!enabled) return

    const environment = pickFirstDefined(import.meta.env.VITE_SENTRY_ENVIRONMENT, import.meta.env.MODE, 'development')
    const release = pickFirstDefined(import.meta.env.VITE_SENTRY_RELEASE)

    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment,
        release,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
        tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
        replaysSessionSampleRate: Number(import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? 0),
        replaysOnErrorSampleRate: Number(import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? 1),
    })
}

export { Sentry }
