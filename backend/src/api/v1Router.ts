import { Router } from 'express'
import { portfolioRouter } from './routes.js'
import { apiKeysRouter } from './apiKeys.routes.js'


const v1Router = Router()

v1Router.use('/', portfolioRouter)
v1Router.use('/api-keys', apiKeysRouter)


export { v1Router }
