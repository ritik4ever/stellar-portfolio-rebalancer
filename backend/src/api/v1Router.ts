import { Router } from 'express'
import { portfolioRouter } from './routes.js'

const v1Router = Router()

v1Router.use('/', portfolioRouter)

export { v1Router }
