import { Router } from 'express'
import { portfoliosRouter } from './portfolios.routes.js'
import { rebalancingRouter } from './rebalancing.routes.js'
import { opsRouter } from './ops.routes.js'
import { notificationsRouter } from './notifications.routes.js'
import { debugRouter } from './debug.routes.js'
import { consentRouter } from './consent.routes.js'
import { assetsRouter } from './assets.routes.js'

export const portfolioRouter = Router()

portfolioRouter.use(portfoliosRouter)
portfolioRouter.use(rebalancingRouter)
portfolioRouter.use(opsRouter)
portfolioRouter.use(notificationsRouter)
portfolioRouter.use(debugRouter)
portfolioRouter.use(consentRouter)
portfolioRouter.use(assetsRouter)
