import { Router } from 'express'
import { portfolioRouter } from './routes.js'
import { authRouter } from './authRoutes.js'

const v1Router = Router()

v1Router.use('/', portfolioRouter)
v1Router.use('/auth', authRouter)

export { v1Router }
