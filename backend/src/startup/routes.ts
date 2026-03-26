import type { Express } from 'express'
import { portfolioRouter } from '../api/routes.js'
import { authRouter } from '../api/authRoutes.js'
import { apiErrorHandler } from '../middleware/apiErrorHandler.js'

export function registerHttpRoutes(app: Express): void {
    app.get('/health', (_req, res) => {
        res.status(200).type('text/plain').send('ok')
    })

    app.use('/api', portfolioRouter)
    app.use('/api/auth', authRouter)

    app.use(apiErrorHandler)
}
