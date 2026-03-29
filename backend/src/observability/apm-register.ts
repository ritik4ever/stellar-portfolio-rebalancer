if (process.env.NEW_RELIC_ENABLED === 'true' && process.env.NEW_RELIC_LICENSE_KEY) {
    await import('newrelic')
}

export {}
