'use strict'

exports.config = {
    app_name: [process.env.NEW_RELIC_APP_NAME || 'stellar-portfolio-backend'],
    license_key: process.env.NEW_RELIC_LICENSE_KEY,
    logging: {
        level: 'info',
    },
    allow_all_headers: true,
    application_logging: {
        forwarding: {
            enabled: true,
        },
        local_decorating: {
            enabled: true,
        },
    },
    distributed_tracing: {
        enabled: process.env.NEW_RELIC_DISTRIBUTED_TRACING_ENABLED !== 'false',
    },
}
