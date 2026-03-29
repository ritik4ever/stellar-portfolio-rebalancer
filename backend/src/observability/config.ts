const parseBoolean = (value: string | undefined, fallback = false): boolean => {
    if (value == null || value.trim() === '') return fallback
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

const parseNumber = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

export const observabilityConfig = {
    sentry: {
        enabled: parseBoolean(process.env.SENTRY_ENABLED, false) && !!process.env.SENTRY_DSN,
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        release: process.env.SENTRY_RELEASE,
        tracesSampleRate: parseNumber(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.2),
        profilesSampleRate: parseNumber(process.env.SENTRY_PROFILES_SAMPLE_RATE, 0.1),
    },
    metrics: {
        enabled: parseBoolean(process.env.METRICS_ENABLED, true),
        prefix: process.env.METRICS_PREFIX || 'stellar_portfolio_',
        serviceName: process.env.METRICS_DEFAULT_LABELS_SERVICE || 'stellar-portfolio-backend',
        deploymentEnv: process.env.LOG_DEPLOYMENT_ENV || process.env.NODE_ENV || 'development',
        alertContact: process.env.ALERT_CONTACT || 'platform-oncall',
    },
    apm: {
        enabled: parseBoolean(process.env.NEW_RELIC_ENABLED, false) && !!process.env.NEW_RELIC_LICENSE_KEY,
    },
} as const
