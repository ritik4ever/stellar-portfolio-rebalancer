import { Router, Request, Response } from 'express'
import { databaseService } from '../services/databaseService.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { userPreferencesSchema, userPreferencesQuerySchema } from './validation.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const preferencesRouter = Router()

// GET /preferences?userAddress=ADDR
preferencesRouter.get('/preferences', validateQuery(userPreferencesQuerySchema), async (req: Request, res: Response) => {
    try {
        const userAddress = req.query.userAddress as string
        const preferences = databaseService.getUserPreferences(userAddress)
        return ok(res, { preferences })
    } catch (error) {
        logger.error('[ERROR] Get user preferences failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// PUT /preferences?userAddress=ADDR
preferencesRouter.put('/preferences', validateQuery(userPreferencesQuerySchema), validateRequest(userPreferencesSchema), async (req: Request, res: Response) => {
    try {
        const userAddress = req.query.userAddress as string
        const updates = req.body

        databaseService.upsertUserPreferences(userAddress, updates)

        const updated = databaseService.getUserPreferences(userAddress)
        return ok(res, { preferences: updated })
    } catch (error) {
        logger.error('[ERROR] Update user preferences failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
