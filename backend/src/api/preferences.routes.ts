import { Router, Request, Response } from 'express'
import { databaseService } from '../services/databaseService.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { userPreferencesSchema, userPreferencesQuerySchema } from './validation.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'
import { requireJwt } from '../middleware/requireJwt.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { notificationService } from '../services/notificationService.js'
import {
    portfolioNotificationOverrideSchema,
    type PortfolioNotificationOverrideInput,
} from '../services/notificationPreferences.js'

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

// ── per-portfolio notification preference overrides (#1395) ──────────────────

/**
 * Read the override for one portfolio, alongside the preferences that actually
 * resolve for it. `overrideApplied: false` means the portfolio is running on
 * global settings.
 */
preferencesRouter.get(
    '/preferences/notifications/portfolio/:portfolioId',
    requireJwt,
    async (req: Request, res: Response) => {
        try {
            const userAddress = req.user!.address
            const { portfolioId } = req.params

            const portfolio = await portfolioStorage.getPortfolio(portfolioId)
            if (!portfolio) return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
            if (portfolio.userAddress !== userAddress) {
                return fail(res, 403, 'FORBIDDEN', 'You can only view your own portfolio preferences')
            }

            const override = notificationService.getPortfolioOverride(userAddress, portfolioId)
            const resolved = notificationService.getPreferencesForPortfolio(userAddress, portfolioId)

            return ok(res, { override: override ?? null, resolved })
        } catch (error) {
            logger.error('[ERROR] Get portfolio notification override failed', { error: getErrorObject(error) })
            return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
        }
    },
)

/** List every portfolio override belonging to the caller. */
preferencesRouter.get(
    '/preferences/notifications/portfolio',
    requireJwt,
    async (req: Request, res: Response) => {
        try {
            const overrides = notificationService.listPortfolioOverrides(req.user!.address)
            return ok(res, { overrides, count: overrides.length })
        } catch (error) {
            logger.error('[ERROR] List portfolio notification overrides failed', { error: getErrorObject(error) })
            return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
        }
    },
)

/** Create or replace the override for one portfolio. */
preferencesRouter.put(
    '/preferences/notifications/portfolio/:portfolioId',
    requireJwt,
    validateRequest(portfolioNotificationOverrideSchema),
    async (req: Request, res: Response) => {
        try {
            const userAddress = req.user!.address
            const { portfolioId } = req.params

            const portfolio = await portfolioStorage.getPortfolio(portfolioId)
            if (!portfolio) return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
            if (portfolio.userAddress !== userAddress) {
                return fail(res, 403, 'FORBIDDEN', 'You can only change your own portfolio preferences')
            }

            const body = req.body as PortfolioNotificationOverrideInput
            const globalPrefs = notificationService.getPreferences(userAddress)

            // Enabling a channel needs a destination from either layer, otherwise
            // the override would resolve to a silently disabled channel.
            if (body.emailEnabled === true && !(body.emailAddress || globalPrefs.emailAddress)) {
                return fail(res, 422, 'VALIDATION_ERROR', 'emailAddress is required to enable email for this portfolio')
            }
            if (body.webhookEnabled === true && !(body.webhookUrl || globalPrefs.webhookUrl)) {
                return fail(res, 422, 'VALIDATION_ERROR', 'webhookUrl is required to enable webhooks for this portfolio')
            }

            const override = notificationService.setPortfolioOverride({
                ...body,
                userId: userAddress,
                portfolioId,
            })

            return ok(res, {
                override,
                resolved: notificationService.getPreferencesForPortfolio(userAddress, portfolioId),
            })
        } catch (error) {
            logger.error('[ERROR] Save portfolio notification override failed', { error: getErrorObject(error) })
            return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
        }
    },
)

/** Delete an override so the portfolio falls back to global preferences. */
preferencesRouter.delete(
    '/preferences/notifications/portfolio/:portfolioId',
    requireJwt,
    async (req: Request, res: Response) => {
        try {
            const userAddress = req.user!.address
            const { portfolioId } = req.params

            const deleted = notificationService.deletePortfolioOverride(userAddress, portfolioId)
            if (!deleted) return fail(res, 404, 'NOT_FOUND', 'No override configured for this portfolio')

            return ok(res, {
                portfolioId,
                deleted: true,
                resolved: notificationService.getPreferencesForPortfolio(userAddress, portfolioId),
            })
        } catch (error) {
            logger.error('[ERROR] Delete portfolio notification override failed', { error: getErrorObject(error) })
            return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
        }
    },
)
