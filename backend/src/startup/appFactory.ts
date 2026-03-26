import express, { type Express } from 'express'
import type { StartupConfig } from '../config/startupConfig.js'
import { applyCoreMiddleware } from './middleware.js'
import { registerHttpRoutes } from './routes.js'

export function createApp(config: StartupConfig): Express {
    const app = express()
    applyCoreMiddleware(app, config)
    registerHttpRoutes(app)
    return app
}
