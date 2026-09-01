import * as Sentry from '@sentry/react'
import type { Event } from '@sentry/react'

const enabled = import.meta.env.VITE_SENTRY_ENABLED === 'true' && !!import.meta.env.VITE_SENTRY_DSN
const REDACTED = '[REDACTED]'

const pickFirstDefined = (...values: Array<string | undefined>): string | undefined => {
    for (const value of values) {
        if (value == null) continue
        const trimmed = value.trim()
        if (trimmed !== '') return trimmed
    }
    return undefined
}

/**
 * Remove credentials and private-key-like values from strings before they reach
 * the reporting SDK. Public Stellar addresses (G...) are intentionally retained.
 */
export function sanitizeObservabilityText(value: string): string {
    return value
        .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
        .replace(/\b(?:access[_-]?token|auth[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key|secret)\s*[:=]\s*[^\s,;]+/gi, (match) => {
            const separator = match.includes('=') ? '=' : ':'
            const key = match.slice(0, match.indexOf(separator)).trim()
            return `${key}${separator}${REDACTED}`
        })
        .replace(/\bS[A-Z2-7]{55}\b/g, REDACTED)
}

export function sanitizeError(error: Error): Error {
    const safeError = new Error(sanitizeObservabilityText(error.message))
    safeError.name = sanitizeObservabilityText(error.name)
    if (error.stack) safeError.stack = sanitizeObservabilityText(error.stack)
    return safeError
}

function scrubEvent(event: Event): Event {
    const safeEvent = { ...event }
    if (safeEvent.message) safeEvent.message = sanitizeObservabilityText(safeEvent.message)
    if (safeEvent.exception?.values) {
        safeEvent.exception = {
            ...safeEvent.exception,
            values: safeEvent.exception.values.map((exception) => ({
                ...exception,
                value: exception.value ? sanitizeObservabilityText(exception.value) : exception.value,
                stacktrace: exception.stacktrace
                    ? { ...exception.stacktrace, frames: exception.stacktrace.frames?.map((frame) => ({
                        ...frame,
                        filename: frame.filename ? sanitizeObservabilityText(frame.filename) : frame.filename,
                        function: frame.function ? sanitizeObservabilityText(frame.function) : frame.function,
                    })) }
                    : exception.stacktrace,
            })),
        }
    }
    return safeEvent
}

export function initializeObservability(): void {
    if (!enabled) return

    const environment = pickFirstDefined(import.meta.env.VITE_SENTRY_ENVIRONMENT, import.meta.env.MODE, 'development')
    const release = pickFirstDefined(import.meta.env.VITE_SENTRY_RELEASE, import.meta.env.VITE_APP_VERSION)

    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment,
        release,
        beforeSend: (event) => scrubEvent(event),
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
        tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
        replaysSessionSampleRate: Number(import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? 0),
        replaysOnErrorSampleRate: Number(import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? 1),
    })
}

export function getAppVersion(): string {
    return pickFirstDefined(import.meta.env.VITE_APP_VERSION, import.meta.env.VITE_SENTRY_RELEASE, 'unknown') ?? 'unknown'
}

export { Sentry }
