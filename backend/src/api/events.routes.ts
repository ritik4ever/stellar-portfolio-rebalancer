import { Router, type Request, type Response } from 'express'
import { eventFeedQuerySchema } from './validation.js'
import { validateQuery } from '../middleware/validate.js'
import { databaseService } from '../services/databaseService.js'
import { ok, fail } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import type { RebalanceEvent } from '../services/rebalanceHistory.js'

export const eventsRouter = Router()

type EventFeedQuery = {
    eventType?: string
    streamId?: string
    actor?: 'user' | 'system' | 'admin' | 'scheduler'
    from?: string
    to?: string
    page: number
    limit: number
}

type EventFeedItem = RebalanceEvent & {
    eventType: string
    streamId: string
}

const parseOptionalDate = (value: string | undefined, field: string): { value?: string; error?: string } => {
    if (!value) return {}
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return { error: `${field} must be a valid date or ISO timestamp` }
    }
    return { value: date.toISOString() }
}

const toFeedItem = (event: RebalanceEvent): EventFeedItem => ({
    ...event,
    eventType: event.onChainEventType ?? event.trigger,
    streamId: event.portfolioId
})

eventsRouter.get('/events', validateQuery(eventFeedQuerySchema), (req: Request, res: Response) => {
    try {
        const query = req.query as unknown as EventFeedQuery
        const from = parseOptionalDate(query.from, 'from')
        if (from.error) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', [{ field: 'from', message: from.error }])
        }

        const to = parseOptionalDate(query.to, 'to')
        if (to.error) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', [{ field: 'to', message: to.error }])
        }

        if (from.value && to.value && from.value > to.value) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', [
                { field: 'from', message: 'from must be before or equal to to' }
            ])
        }

        const result = databaseService.getGlobalEventFeed({
            eventType: query.eventType,
            streamId: query.streamId,
            actor: query.actor,
            from: from.value,
            to: to.value,
            page: query.page,
            limit: query.limit
        })

        return ok(res, {
            data: result.data.map(toFeedItem),
            total: result.total,
            page: result.page,
            limit: result.limit,
            filters: {
                eventType: query.eventType,
                streamId: query.streamId,
                actor: query.actor,
                from: from.value,
                to: to.value
            }
        })
    } catch (error) {
        logger.error('[ERROR] Global event feed failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
