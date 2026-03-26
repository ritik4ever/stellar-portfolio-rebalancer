import type { Express, Request, Response } from 'express'
import { portfolioRouter } from '../api/routes.js'
import { authRouter } from '../api/authRoutes.js'
import { v1Router } from '../api/v1Router.js'
import { legacyApiDeprecation } from '../middleware/legacyApiDeprecation.js'

export function mountApiRoutes(app: Express): void {
    app.use('/api/v1', v1Router)
    app.use('/api/auth', authRouter)
    app.use('/api', legacyApiDeprecation, portfolioRouter)
}

export function mountLegacyNonApiRedirects(app: Express): void {
    app.get('/rebalance/history', (req: Request, res: Response) => {
        const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
        res.redirect(308, `/api/v1/rebalance/history${search}`)
    })
}
