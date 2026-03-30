import { Router } from 'express'
import { consentRouter } from './consent.routes.js'
import { assetsRouter } from './assets.routes.js'
import { rebalancingRouter } from './rebalancing.routes.js'
import { portfoliosRouter } from './portfolios.routes.js'
import { notificationsRouter } from './notifications.routes.js'
import { opsRouter } from './ops.routes.js'
import { debugRouter } from './debug.routes.js'

export const portfolioRouter = Router()

// Compose all domain-specific routers
portfolioRouter.use(consentRouter)
portfolioRouter.use(assetsRouter)
portfolioRouter.use(rebalancingRouter)
portfolioRouter.use(portfoliosRouter)
portfolioRouter.use(notificationsRouter)
portfolioRouter.use(opsRouter)
portfolioRouter.use(debugRouter)
