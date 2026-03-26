import type { Express } from 'express'
import express from 'express'
import cors from 'cors'
import type { StartupConfig } from '../config/startupConfig.js'
import { requestContextMiddleware } from '../middleware/requestContext.js'

export function buildCorsOptions(config: StartupConfig): cors.CorsOptions {
    return {
        origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'Accept',
            'Origin',
            'X-Requested-With',
            'X-Request-Id'
        ]
    }
}

export function applyCoreMiddleware(app: Express, config: StartupConfig): void {
    const corsOptions = buildCorsOptions(config)
    app.use(cors(corsOptions))
    app.options('*', cors(corsOptions))

    app.use(requestContextMiddleware)
    app.use(express.json({ limit: '10mb' }))
    app.use(express.urlencoded({ extended: true, limit: '10mb' }))
    app.set('trust proxy', 1)
}
