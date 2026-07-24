import { Router, Request, Response } from 'express'
import { requireAdmin } from '../middleware/auth.js'
import { adminRateLimiter } from '../middleware/rateLimit.js'
import { contractEventsService } from '../services/contractEvents.js'
import { ok, fail } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'
import { getErrorMessage } from '../utils/helpers.js'

export const eventsRouter = Router()

/**
 * POST /admin/events/replay?from_ledger=N
 *
 * Re-index contract events starting from the given ledger sequence.
 * Useful for recovery after indexer downtime.
 *
 * - Admin-only (requires X-Public-Key / X-Message / X-Signature headers).
 * - Replay fills gaps without creating duplicates.
 * - Progress logged with ledger sequence.
 * - Replay can be interrupted and resumed.
 */
eventsRouter.post(
    '/admin/events/replay',
    requireAdmin,
    adminRateLimiter,
    async (req: Request, res: Response) => {
        try {
            const fromLedgerRaw = req.query.from_ledger

            if (fromLedgerRaw === undefined || fromLedgerRaw === '') {
                return fail(
                    res,
                    400,
                    'VALIDATION_ERROR',
                    'Missing required query parameter: from_ledger'
                )
            }

            const fromLedger = Number(fromLedgerRaw)

            if (!Number.isInteger(fromLedger) || fromLedger < 1) {
                return fail(
                    res,
                    400,
                    'VALIDATION_ERROR',
                    'from_ledger must be a positive integer'
                )
            }

            logger.info('[ADMIN] Event replay requested', {
                fromLedger,
                admin: req.adminPublicKey
            })

            const result = await contractEventsService.replayFromLedger(fromLedger)

            if (!result.success) {
                return fail(res, 422, 'REPLAY_FAILED', result.message)
            }

            return ok(res, result)
        } catch (error) {
            logger.error('[ADMIN] Event replay failed', { error: getErrorMessage(error) })
            return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
        }
    }
)
