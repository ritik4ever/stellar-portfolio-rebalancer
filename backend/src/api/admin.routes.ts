import { Router, Request, Response } from 'express'
import { requireAdmin } from '../middleware/auth.js'
import { databaseService } from '../services/databaseService.js'
import { issuerMetadataService } from '../services/issuerMetadataService.js'
import {
  MAX_VOLATILITY_THRESHOLD_PCT,
  MIN_VOLATILITY_THRESHOLD_PCT,
  getVolatilityThresholdPct,
  setVolatilityThresholdPct,
} from '../config/volatilityConfig.js'
import { logger } from '../utils/logger.js'
import { ok, fail } from '../utils/apiResponse.js'
import { getErrorMessage } from '../utils/helpers.js'
import {
  getAnomalyThresholds,
  setAnomalyThresholds,
  getAnomalySummary,
  AnomalyThresholds
} from '../monitoring/anomalyTracker.js'

export const adminRouter = Router()

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

function logAdminAction(actor: string, action: string, target: string | null, before?: unknown, after?: unknown): void {
  try {
    databaseService.recordAdminAuditEntry(actor, action, target, before ?? null, after ?? null)
  } catch (err) {
    logger.warn('[ADMIN] Failed to record audit entry', { error: getErrorMessage(err), action, target })
  }
}

const VALID_THRESHOLD_KEYS: (keyof AnomalyThresholds)[] = [
  'criticalRiskAlerts',
  'warningRiskAlerts',
  'infoRiskAlerts',
  'rebalanceBlocks',
  'priceFeedAnomalies',
  'circuitBreakerTriggers',
  'totalAnomalies'
]

function handleGetAnomalyThresholds(_req: Request, res: Response) {
  try {
    const summary = getAnomalySummary()
    return ok(res, {
      thresholds: summary.thresholds,
      summary: {
        counts: {
          riskAlerts: summary.riskAlerts,
          rebalanceBlocks: summary.rebalanceBlocks,
          priceFeedAnomalies: summary.priceFeedAnomalies,
          circuitBreakerTriggers: summary.circuitBreakerTriggers,
          total: summary.total
        },
        exceeded: summary.exceeded,
        exceededMetrics: summary.exceededMetrics
      }
    })
  } catch (error) {
    logger.error('[ADMIN] Failed to get anomaly thresholds', { error: getErrorMessage(error) })
    return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
  }
}

function handleUpdateAnomalyThresholds(req: Request, res: Response) {
  try {
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object')
    }

    const keys = Object.keys(body)
    if (keys.length === 0) {
      return fail(res, 400, 'VALIDATION_ERROR', 'At least one threshold field must be provided')
    }

    const updates: Partial<AnomalyThresholds> = {}
    for (const key of keys) {
      if (!VALID_THRESHOLD_KEYS.includes(key as keyof AnomalyThresholds)) {
        return fail(res, 400, 'VALIDATION_ERROR', `Invalid threshold key '${key}'. Allowed keys: ${VALID_THRESHOLD_KEYS.join(', ')}`)
      }
      const val = body[key]
      if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || !Number.isInteger(val)) {
        return fail(res, 400, 'VALIDATION_ERROR', `Threshold value for '${key}' must be a non-negative integer`)
      }
      updates[key as keyof AnomalyThresholds] = val
    }

    const before = getAnomalyThresholds()
    const updated = setAnomalyThresholds(updates)
    const actor = req.adminPublicKey ?? 'unknown'

    logAdminAction(actor, 'update_anomaly_thresholds', 'anomaly_tracker', before, updated)

    const summary = getAnomalySummary()
    return ok(res, {
      message: 'Anomaly detection thresholds updated successfully',
      thresholds: updated,
      summary: {
        counts: {
          riskAlerts: summary.riskAlerts,
          rebalanceBlocks: summary.rebalanceBlocks,
          priceFeedAnomalies: summary.priceFeedAnomalies,
          circuitBreakerTriggers: summary.circuitBreakerTriggers,
          total: summary.total
        },
        exceeded: summary.exceeded,
        exceededMetrics: summary.exceededMetrics
      }
    })
  } catch (error) {
    logger.error('[ADMIN] Failed to update anomaly thresholds', { error: getErrorMessage(error) })
    return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
  }
}

// GET & PUT/PATCH routes for anomaly-thresholds (and anomaly-detection/thresholds alias)
adminRouter.get('/anomaly-thresholds', requireAdmin, handleGetAnomalyThresholds)
adminRouter.get('/anomaly-detection/thresholds', requireAdmin, handleGetAnomalyThresholds)

adminRouter.put('/anomaly-thresholds', requireAdmin, handleUpdateAnomalyThresholds)
adminRouter.patch('/anomaly-thresholds', requireAdmin, handleUpdateAnomalyThresholds)
adminRouter.put('/anomaly-detection/thresholds', requireAdmin, handleUpdateAnomalyThresholds)
adminRouter.patch('/anomaly-detection/thresholds', requireAdmin, handleUpdateAnomalyThresholds)

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

    if (!Array.isArray(params)) {
      return fail(res, 400, 'VALIDATION_ERROR', 'params must be an array')
    }

    const actor = req.adminPublicKey ?? 'unknown'
    logger.info('[ADMIN] EXPLAIN ANALYZE requested', { queryId, adminPublicKey: actor })

    const db = (databaseService as any).db
    if (!db) {
      return fail(res, 500, 'INTERNAL_ERROR', 'Database connection not available')
    }

    const explainQuery = `EXPLAIN ANALYZE ${query}`
    const explainStart = Date.now()
    
    try {
      const explainResult = db.prepare(explainQuery).all(...params)
      const explainTimeMs = Date.now() - explainStart

      const explainPlan = explainResult.map((row: any) => row.detail || JSON.stringify(row)).join('\n')
      
      const estimatedRowsMatch = explainPlan.match(/rows=(\d+)/)
      const actualRowsMatch = explainPlan.match(/actual rows=(\d+)/)
      
      const estimatedRows = estimatedRowsMatch ? parseInt(estimatedRowsMatch[1], 10) : null
      const actualRows = actualRowsMatch ? parseInt(actualRowsMatch[1], 10) : null

      const queryStart = Date.now()
      const actualResult = db.prepare(query).all(...params)
      const queryTimeMs = Date.now() - queryStart

      logAdminAction(actor, 'db_explain', queryId, null, { rowCount: actualResult.length })

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

adminRouter.get('/db/queries', requireAdmin, async (req: Request, res: Response) => {
  try {
    const queries = Object.keys(PREDEFINED_QUERIES).map(key => ({
      id: key,
      query: PREDEFINED_QUERIES[key]
    }))
    logAdminAction(req.adminPublicKey ?? 'unknown', 'list_queries', null)
    return ok(res, { queries })
  } catch (error) {
    logger.error('[ADMIN] Failed to list queries', { error: getErrorMessage(error) })
    return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
  }
})

adminRouter.get('/audit-log', requireAdmin, async (req: Request, res: Response) => {
  try {
    const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined
    const action = typeof req.query.action === 'string' ? req.query.action : undefined
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0

    const result = databaseService.queryAdminAuditLog({ actor, action, startDate, endDate, limit, offset })
    return ok(res, result)
  } catch (error) {
    logger.error('[ADMIN] Failed to query audit log', { error: getErrorMessage(error) })
    return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
  }
})

