import { Router } from 'express'
import { portfolioRouter } from './routes.js'
import { authRouter } from './authRoutes.js'
import { notificationsRouter } from './notifications.routes.js'
import { debugRouter } from './debug.routes.js'

const v1Router = Router()

v1Router.use('/', portfolioRouter)
v1Router.use('/auth', authRouter)
v1Router.use('/', notificationsRouter)
v1Router.use('/', debugRouter)

export { v1Router }
