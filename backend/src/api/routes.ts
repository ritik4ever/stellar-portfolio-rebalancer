import { Router } from 'express'
import { portfoliosRouter } from './portfolios.routes.js'
import { portfolioImportRouter } from './portfolioImportRoutes.js'
import { rebalancingRouter } from './rebalancing.routes.js'
import { opsRouter } from './ops.routes.js'
import { notificationsRouter } from './notifications.routes.js'
import { debugRouter } from './debug.routes.js'
import { consentRouter } from './consent.routes.js'
import { assetsRouter } from './assets.routes.js'
import { analyticsRouter } from './analytics.routes.js'
import { adminRouter } from './admin.routes.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import { logger } from '../utils/logger.js'


export const portfolioRouter = Router()

portfolioRouter.use(portfoliosRouter)
portfolioRouter.use(portfolioImportRouter)
portfolioRouter.use(rebalancingRouter)
portfolioRouter.use(opsRouter)
portfolioRouter.use(notificationsRouter)

// Debug routes are mounted ONLY when explicitly enabled via ENABLE_DEBUG_ROUTES=true
// and NODE_ENV is not production. This is a defense-in-depth double check on top of
// the per-route blockDebugInProduction middleware.
const environment = (process.env.NODE_ENV || 'development').trim().toLowerCase()
const isProduction = environment === 'production'
const debugRoutesEnabled = getFeatureFlags().enableDebugRoutes && !isProduction

if (debugRoutesEnabled) {
    logger.warn('[SECURITY] Debug routes are ENABLED (ENABLE_DEBUG_ROUTES=true). ' +
        'These endpoints expose internal state and must never be enabled in production.')
    portfolioRouter.use(debugRouter)
} else {
    logger.info(`[SECURITY] Debug routes disabled (enableDebugRoutes=${getFeatureFlags().enableDebugRoutes}, NODE_ENV=${environment})`)
}

portfolioRouter.use(consentRouter)
portfolioRouter.use(assetsRouter)
portfolioRouter.use(analyticsRouter)

