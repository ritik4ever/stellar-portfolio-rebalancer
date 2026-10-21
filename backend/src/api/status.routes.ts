import { Router, Request, Response } from 'express'
import { getPublicStatus } from '../monitoring/publicStatus.js'
import { ok, fail } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'

export const statusRouter = Router()

/**
 * Public connectivity status for the Reflector oracle and the Stellar DEX.
 *
 * Deliberately unauthenticated and free of user data: it answers the question a
 * visitor asks before trusting the platform with funds — "is it working right
 * now?" — from live probes, never from a static claim.
 *
 * This always answers `200` because the report itself carries the health, and a
 * status page should render a degraded platform rather than treat its own
 * response code as the signal; `/health` remains the machine-facing liveness
 * gate that answers `503`. Results are cached for
 * `PUBLIC_STATUS_CACHE_TTL_MS` (default 15s) so polling cannot hammer the
 * upstreams.
 */
statusRouter.get('/status', async (_req: Request, res: Response) => {
    try {
        const report = await getPublicStatus()
        return ok(res, report)
    } catch (error) {
        logger.error('[STATUS] Failed to build public status report', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
