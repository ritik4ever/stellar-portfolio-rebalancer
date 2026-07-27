import { Router, Request, Response } from 'express'
import { requireAdmin } from '../middleware/auth.js'
import { databaseService } from '../services/databaseService.js'
import { logger } from '../utils/logger.js'
import { ok, fail } from '../utils/apiResponse.js'
import { getErrorMessage } from '../utils/helpers.js'

export const adminRouter = Router()

// Predefined safe queries for EXPLAIN ANALYZE
const PREDEFINED_QUERIES: Record<string, string> = {
  'get_all_portfolios': 'SELECT * FROM portfolios ORDER BY created_at DESC',
  'get_portfolio_count': 'SELECT COUNT(*) as cnt FROM portfolios',
  'get_rebalance_history': 'SELECT * FROM rebalance_history ORDER BY timestamp DESC LIMIT 100',
  'get_assets': 'SELECT * FROM assets WHERE enabled = 1',
  'get_user_portfolios': 'SELECT * FROM portfolios WHERE user_address = ?',
  'search_portfolios': 'SELECT * FROM portfolios WHERE name LIKE ? OR description LIKE ? ORDER BY created_at DESC',
  'get_portfolio_by_id': 'SELECT * FROM portfolios WHERE id = ?',
  'get_rebalance_history_by_portfolio': 'SELECT * FROM rebalance_history WHERE portfolio_id = ? ORDER BY timestamp DESC',
  'get_consent_audit_events': 'SELECT * FROM consent_audit_events ORDER BY timestamp DESC',
  'get_portfolio_drafts': 'SELECT * FROM portfolio_drafts WHERE user_address = ?'
}

/**
 * POST /api/v1/admin/db/explain
 * 
 * Accepts a named query identifier and returns EXPLAIN ANALYZE output.
 * Restricted to admin only.
 * Only predefined queries are allowed to prevent SQL injection.
 * 
 * Request body:
 * {
 *   "queryId": "get_all_portfolios",
 *   "params": [] // Optional parameters for parameterized queries
 * }
 * 
 * Response:
 * {
 *   "queryId": "get_all_portfolios",
 *   "explainPlan": "...",
 *   "executionTimeMs": 1.23,
 *   "estimatedRows": 100,
 *   "actualRows": 95
 * }
 */
adminRouter.post('/db/explain', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { queryId, params = [] } = req.body

    if (!queryId || typeof queryId !== 'string') {
      return fail(res, 400, 'VALIDATION_ERROR', 'queryId is required and must be a string')
    }

    const query = PREDEFINED_QUERIES[queryId]
    if (!query) {
      return fail(res, 400, 'VALIDATION_ERROR', `Unknown query identifier: ${queryId}. Available queries: ${Object.keys(PREDEFINED_QUERIES).join(', ')}`)
    }

    // Validate params is an array
    if (!Array.isArray(params)) {
      return fail(res, 400, 'VALIDATION_ERROR', 'params must be an array')
    }

    logger.info('[ADMIN] EXPLAIN ANALYZE requested', { queryId, adminPublicKey: req.adminPublicKey })

    const db = (databaseService as any).db
    if (!db) {
      return fail(res, 500, 'INTERNAL_ERROR', 'Database connection not available')
    }

    // First, run EXPLAIN ANALYZE on the query
    const explainQuery = `EXPLAIN ANALYZE ${query}`
    const explainStart = Date.now()
    
    try {
      const explainResult = db.prepare(explainQuery).all(...params)
      const explainTimeMs = Date.now() - explainStart

      // Parse the EXPLAIN ANALYZE output to extract estimated vs actual row counts
      const explainPlan = explainResult.map((row: any) => row.detail || JSON.stringify(row)).join('\n')
      
      // Extract estimated and actual rows from the plan
      const estimatedRowsMatch = explainPlan.match(/rows=(\d+)/)
      const actualRowsMatch = explainPlan.match(/actual rows=(\d+)/)
      
      const estimatedRows = estimatedRowsMatch ? parseInt(estimatedRowsMatch[1], 10) : null
      const actualRows = actualRowsMatch ? parseInt(actualRowsMatch[1], 10) : null

      // Also run the actual query to get the real row count
      const queryStart = Date.now()
      const actualResult = db.prepare(query).all(...params)
      const queryTimeMs = Date.now() - queryStart

      return ok(res, {
        queryId,
        query,
        explainPlan,
        explainExecutionTimeMs: explainTimeMs,
        queryExecutionTimeMs: queryTimeMs,
        estimatedRows,
        actualRows: actualResult.length,
        rowCount: actualResult.length
      })
    } catch (dbError) {
      logger.error('[ADMIN] EXPLAIN ANALYZE failed', { error: getErrorMessage(dbError), queryId })
      return fail(res, 500, 'DATABASE_ERROR', `Failed to execute EXPLAIN ANALYZE: ${getErrorMessage(dbError)}`)
    }
  } catch (error) {
    logger.error('[ADMIN] Unexpected error in db/explain endpoint', { error: getErrorMessage(error) })
    return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
  }
})

/**
 * GET /api/v1/admin/db/queries
 * 
 * Returns the list of available predefined query identifiers.
 * Restricted to admin only.
 */
adminRouter.get('/db/queries', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const queries = Object.keys(PREDEFINED_QUERIES).map(key => ({
      id: key,
      query: PREDEFINED_QUERIES[key]
    }))
    return ok(res, { queries })
  } catch (error) {
    logger.error('[ADMIN] Failed to list queries', { error: getErrorMessage(error) })
    return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
  }
})
