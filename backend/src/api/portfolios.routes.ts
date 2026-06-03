import { Router, Request, Response } from 'express'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { databaseService } from '../services/databaseService.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { analyticsService } from '../services/analyticsService.js'

import { riskManagementService } from '../services/serviceContainer.js'

import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { requireJwt, requireJwtWhenEnabled } from '../middleware/requireJwt.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'

import { getAuthConfig } from '../services/authService.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import { getPortfolioExport } from '../services/portfolioExportService.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'
import { ConflictError } from '../types/index.js'
import { updatePortfolioSchema } from './validation.js'
import type { Portfolio } from '../types/index.js'
import type { ExecuteRebalanceOptions } from '../services/stellar.js'

export const portfoliosRouter = Router()

const stellarService = new StellarService()
const reflectorService = new ReflectorService()
const featureFlags = getFeatureFlags()


    try {
        const parsed = createPortfolioSchema.safeParse(req.body)
        if (!parsed.success) {
            const first = parsed.error.issues[0]
            const message = first?.message ?? 'Validation failed'
            const fullMessage = parsed.error.issues.some((e) => e.path.join('.') !== '')
                ? message
                : req.body?.userAddress == null
                    ? 'Missing required fields: userAddress, allocations, threshold'
                    : req.body?.allocations == null
                        ? 'Missing required fields: allocations, threshold'
                        : req.body?.threshold == null
                            ? 'Missing required fields: threshold'
                            : message
            return fail(res, 400, 'VALIDATION_ERROR', fullMessage)
        }
        const { userAddress, allocations, threshold, slippageTolerance, strategy, strategyConfig } = parsed.data

        const slippageTolerancePercent = slippageTolerance ?? 1
        const portfolioId = await stellarService.createPortfolio(
            userAddress,
            allocations,
            threshold,
            slippageTolerancePercent,
            strategy ?? 'threshold',
            strategyConfig ?? {}
        )
        const mode = featureFlags.demoMode ? 'demo' : 'onchain'
        return ok(res, {
            portfolioId,
            status: 'created',
            mode
        }, { status: 201 })
    } catch (error) {
        logger.error('[ERROR] Create portfolio failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Update portfolio with optimistic concurrency control
portfoliosRouter.put('/portfolio/:id', ...protectedWriteLimiter, idempotencyMiddleware, validateRequest(updatePortfolioSchema), async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id;
        if (!portfolioId) return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required');
        const { version, ...updates } = req.body;
        if (version === undefined) return fail(res, 400, 'VALIDATION_ERROR', 'Version is required for update');
        const okUpdate = await portfolioStorage.updatePortfolio(portfolioId, updates, version);
        if (!okUpdate) return fail(res, 409, 'CONFLICT', 'Version conflict', { currentVersion: (await portfolioStorage.getPortfolio(portfolioId))?.version });
        const updated = await portfolioStorage.getPortfolio(portfolioId);
        return ok(res, { portfolio: updated }, { status: 200 });
    } catch (error) {
        if (error instanceof ConflictError) {
            return fail(res, 409, 'CONFLICT', error.message);
        }
        logger.error('[ERROR] Update portfolio failed', { error: getErrorObject(error) });
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error));
    }
});

portfoliosRouter.get('/portfolio/:id', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        if (!portfolioId) return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        
        let portfolio: any
        let riskHeatmap: any = undefined
        
        try {
            portfolio = await stellarService.getPortfolio(portfolioId)
            
            try {
                const prices = await reflectorService.getCurrentPrices()
                riskHeatmap = riskManagementService.calculateRiskHeatmap(portfolio.allocations, prices)
            } catch (err) {
                logger.warn('[WARN] Failed to calculate risk heatmap for portfolio, falling back', { portfolioId, error: getErrorObject(err) })
            }
        } catch (error) {
            const errMsg = getErrorMessage(error)
            if (errMsg.includes('Portfolio not found')) {
                return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
            }
            
            logger.warn('[WARN] Failed to fetch portfolio with prices, attempting storage fallback', { portfolioId, error: getErrorObject(error) })
            const rawPortfolio = await portfolioStorage.getPortfolio(portfolioId)
            if (!rawPortfolio) {
                return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
            }
            
            portfolio = {
                id: portfolioId,
                userAddress: rawPortfolio.userAddress,
                totalValue: rawPortfolio.totalValue || 0,
                allocations: Object.entries(rawPortfolio.allocations).map(([asset, target]) => ({
                    asset,
                    target,
                    current: target,
                    amount: 0,
                    balance: rawPortfolio.balances[asset] || 0,
                    price: 0
                })),
                needsRebalance: false,
                lastRebalance: rawPortfolio.lastRebalance,
                threshold: rawPortfolio.threshold,
                slippageTolerancePercent: rawPortfolio.slippageTolerancePercent ?? rawPortfolio.slippageTolerance ?? 1,
                dayChange: 0
            }
        }

        return ok(res, { portfolio, riskHeatmap })
    } catch (error) {
        logger.error('[ERROR] Get portfolio failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// ================================
// DRAFT PORTFOLIO ROUTES
// ================================

portfoliosRouter.post('/portfolio/draft', ...protectedWriteLimiter, idempotencyMiddleware, async (req: Request, res: Response) => {
    try {
        const parsed = createDraftSchema.safeParse(req.body)
        if (!parsed.success) {
            const first = parsed.error.issues[0]
            return fail(res, 400, 'VALIDATION_ERROR', first?.message ?? 'Validation failed')
        }
        const { userAddress, allocations, threshold, slippageTolerance, strategy, strategyConfig, label } = parsed.data
        const draftId = databaseService.createDraft({
            userAddress,
            label,
            allocations,
            threshold,
            slippageTolerancePercent: slippageTolerance ?? 1,
            strategy: strategy ?? 'threshold',
            strategyConfig: strategyConfig ?? {},
        })
        logger.info('[DRAFT] Created portfolio draft', { draftId, userAddress })
        return ok(res, { draftId, status: 'draft_created' }, { status: 201 })
    } catch (error) {
        logger.error('[DRAFT] Create draft failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.get('/portfolio/draft/:id', async (req: Request, res: Response) => {
    try {
        const draftId = req.params.id
        if (!draftId) return fail(res, 400, 'VALIDATION_ERROR', 'Draft ID required')
        const draft = databaseService.getDraft(draftId)
        if (!draft) return fail(res, 404, 'NOT_FOUND', 'Draft not found')
        return ok(res, { draft })
    } catch (error) {
        logger.error('[DRAFT] Get draft failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.patch('/portfolio/draft/:id', ...protectedWriteLimiter, idempotencyMiddleware, async (req: Request, res: Response) => {
    try {
        const draftId = req.params.id
        if (!draftId) return fail(res, 400, 'VALIDATION_ERROR', 'Draft ID required')
        const parsed = updateDraftSchema.safeParse(req.body)
        if (!parsed.success) {
            const first = parsed.error.issues[0]
            return fail(res, 400, 'VALIDATION_ERROR', first?.message ?? 'Validation failed')
        }
        const { allocations, threshold, slippageTolerance, strategy, strategyConfig, label } = parsed.data
        const updated = databaseService.updateDraft(draftId, {
            label,
            allocations,
            threshold,
            slippageTolerancePercent: slippageTolerance,
            strategy,
            strategyConfig,
        })
        if (!updated) return fail(res, 404, 'NOT_FOUND', 'Draft not found')
        logger.info('[DRAFT] Updated portfolio draft', { draftId })
        return ok(res, { draftId, status: 'draft_updated' })
    } catch (error) {
        logger.error('[DRAFT] Update draft failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.post('/portfolio/draft/:id/publish', ...protectedWriteLimiter, idempotencyMiddleware, async (req: Request, res: Response) => {
    try {
        const draftId = req.params.id
        if (!draftId) return fail(res, 400, 'VALIDATION_ERROR', 'Draft ID required')
        const portfolioId = databaseService.publishDraft(draftId)
        if (!portfolioId) return fail(res, 404, 'NOT_FOUND', 'Draft not found')
        logger.info('[DRAFT] Published draft to portfolio', { draftId, portfolioId })
        return ok(res, { portfolioId, status: 'published' }, { status: 201 })
    } catch (error) {
        logger.error('[DRAFT] Publish draft failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.delete('/portfolio/draft/:id', ...protectedWriteLimiter, async (req: Request, res: Response) => {
    try {
        const draftId = req.params.id
        if (!draftId) return fail(res, 400, 'VALIDATION_ERROR', 'Draft ID required')
        const deleted = databaseService.deleteDraft(draftId)
        if (!deleted) return fail(res, 404, 'NOT_FOUND', 'Draft not found')
        logger.info('[DRAFT] Deleted portfolio draft', { draftId })
        return ok(res, { draftId, status: 'draft_deleted' })
    } catch (error) {
        logger.error('[DRAFT] Delete draft failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.get('/user/:address/drafts', async (req: Request, res: Response) => {
    try {
        const address = req.params.address
        if (!address) return fail(res, 400, 'VALIDATION_ERROR', 'User address required')
        const drafts = databaseService.listDrafts(address)
        return ok(res, { drafts })
    } catch (error) {
        logger.error('[DRAFT] List drafts failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Portfolio export (JSON, CSV, PDF) — GDPR data portability
portfoliosRouter.get('/portfolio/:id/export', requireJwtWhenEnabled, validateQuery(portfolioExportQuerySchema), async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        const format = req.query.format as 'json' | 'csv' | 'pdf'
        if (!portfolioId) return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        const portfolio = await portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        const authConfig = getAuthConfig()
        if (authConfig.enabled && (!req.user || portfolio.userAddress !== req.user.address)) {
            return fail(res, 403, 'FORBIDDEN', 'You can only export your own portfolio')
        }
        if (!databaseService.hasFullConsent(portfolio.userAddress)) {
            return fail(res, 403, 'FORBIDDEN', 'Active consent is required before exporting portfolio data')
        }

        const queue = await import('../queue/queues.js').then(m => m.getPortfolioExportQueue())
        if (!queue) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Export service is temporarily unavailable (queue missing)')
        }

        const job = await queue.add(`export-${portfolioId}-${Date.now()}`, {
            portfolioId,
            format,
            userId: req.user?.address
        })

        return ok(res, { jobId: job.id, status: 'processing' }, { status: 202 })
    } catch (error) {
        logger.error('[ERROR] Portfolio export job creation failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.get('/portfolio/:id/export/status/:jobId', requireJwtWhenEnabled, async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        const jobId = req.params.jobId
        
        const portfolio = await portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        
        const authConfig = getAuthConfig()
        if (authConfig.enabled && (!req.user || portfolio.userAddress !== req.user.address)) {
            return fail(res, 403, 'FORBIDDEN', 'You can only check your own export')
        }

        const queue = await import('../queue/queues.js').then(m => m.getPortfolioExportQueue())
        if (!queue) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Queue service unavailable')
        }

        const job = await queue.getJob(jobId)
        if (!job) {
            return fail(res, 404, 'NOT_FOUND', 'Export job not found')
        }

        // Check if job matches the requested portfolio
        if (job.data.portfolioId !== portfolioId) {
            return fail(res, 403, 'FORBIDDEN', 'Job does not belong to this portfolio')
        }

        const state = await job.getState()
        if (state === 'failed') {
            return ok(res, { status: 'failed', error: job.failedReason || 'Unknown error during export' })
        }
        
        if (state === 'completed') {
            const result = job.returnvalue
            if (!result) {
                return fail(res, 500, 'INTERNAL_ERROR', 'Job completed but no result found')
            }
            res.setHeader('Content-Type', result.contentType)
            res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
            if (result.bodyBase64) {
                return res.send(Buffer.from(result.bodyBase64, 'base64'))
            }
            return res.send(result.bodyString)
        }

        return ok(res, { status: 'processing', state })
    } catch (error) {
        logger.error('[ERROR] Portfolio export status check failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.get('/user/:address/portfolios', async (req: Request, res: Response) => {
    try {
        const address = req.params.address
        if (!address) return fail(res, 400, 'VALIDATION_ERROR', 'User address required')
        const authConfig = getAuthConfig()
        const allowPublicInDemo =
            authConfig.enabled &&
            featureFlags.demoMode &&
            featureFlags.allowPublicUserPortfoliosInDemo

        if (authConfig.enabled && !allowPublicInDemo) {
            let nextCalled = false
            requireJwt(req, res, () => { nextCalled = true })
            if (!nextCalled) return

            if (req.user?.address !== address) {
                return fail(res, 403, 'FORBIDDEN', 'You can only view your own portfolios')
            }
        }

        const list = await portfolioStorage.getUserPortfolios(address)

        return ok(res, { portfolios: list })
    } catch (error) {
        logger.error('[ERROR] Get user portfolios failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.get('/portfolio/:id/rebalance-plan', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        if (!portfolioId) return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        const portfolio = await portfolioStorage.getPortfolio(portfolioId) as Portfolio | undefined
        if (!portfolio) return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        const { prices, feedMeta } = await reflectorService.getCurrentPricesWithMeta()
        const totalValue = Object.entries(portfolio.balances || {}).reduce((sum, [asset, bal]) => sum + (bal * (prices[asset]?.price ?? 0)), 0)
        const slippageTolerancePercent = portfolio.slippageTolerancePercent ?? 1
        const estimatedSlippageBps = Math.round(slippageTolerancePercent * 100)
        return ok(res, {
            portfolioId,
            totalValue,
            maxSlippagePercent: slippageTolerancePercent,
            estimatedSlippageBps,
            prices: Object.keys(prices).length > 0 ? prices : undefined,
            priceFeedMeta: feedMeta
        })
    } catch (error) {
        logger.error('[ERROR] Rebalance plan failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.get('/portfolio/:id/rebalance-estimate', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        if (!portfolioId) return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        const estimate = await stellarService.estimateRebalanceGas(portfolioId)

        return ok(res, estimate)
    } catch (error) {
        logger.error('[ERROR] Rebalance estimate failed', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})


    try {
        const portfolioId = req.params.id;

        console.log(`[INFO] Attempting manual rebalance for portfolio: ${portfolioId}`);

        // Try to acquire lock
        const lockAcquired = await acquireWorkerLock(portfolioId);
        if (!lockAcquired) {
            console.log(`[WARNING] Rebalance already in progress for portfolio: ${portfolioId}`);
            return fail(res, 409, 'CONFLICT', 'Rebalance already in progress for this portfolio');
        }

        try {
            const portfolio = await stellarService.getPortfolio(portfolioId);
            if (!portfolio) {
                return fail(res, 404, 'NOT_FOUND', 'Portfolio not found');
            }
            const authConfig = getAuthConfig()
            if (authConfig.enabled && (!req.user || portfolio.userAddress !== req.user.address)) {
                return fail(res, 403, 'FORBIDDEN', 'You can only rebalance your own portfolio');
            }
            const prices = await reflectorService.getCurrentPrices();
            const riskCheck = riskManagementService.shouldAllowRebalance(portfolio as unknown as Portfolio, prices);

            if (!riskCheck.allowed) {
                return fail(res, 400, 'BAD_REQUEST', riskCheck.reason ?? 'Rebalance blocked by risk checks', { alerts: riskCheck.alerts });
            }

            const result = await stellarService.executeRebalance(portfolioId, mapRebalanceOptions(req.body));

            logger.info('Rebalance executed', { portfolioId, status: result.status, explanation: result.explanation });

            return ok(res, { result });
        } finally {
            await releaseWorkerLock(portfolioId);
        }
    } catch (error) {
        if (error instanceof ConflictError) {
            return fail(res, 409, 'CONFLICT', error.message);
        }
        console.error('[ERROR] Manual rebalance failed:', error);
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error));
    }

});

// ================================
// ANALYTICS ROUTES
// ================================

portfoliosRouter.get('/portfolio/:id/analytics', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        const days = parseInt(req.query.days as string) || 30

        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        const portfolio = portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        }

        const analytics = analyticsService.getAnalytics(portfolioId, days)

        return ok(
            res,
            {
                portfolioId,
                data: analytics
            },
            { meta: { count: analytics.length, period: `${days} days` } }
        )
    } catch (error) {
        logger.error('Failed to fetch analytics', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.get('/portfolio/:id/performance-summary', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id

        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        const portfolio = portfolioStorage.getPortfolio(portfolioId)
        if (!portfolio) {
            return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
        }

        const summary = analyticsService.getPerformanceSummary(portfolioId)

        return ok(res, { portfolioId, ...summary })
    } catch (error) {
        logger.error('Failed to fetch performance summary', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

portfoliosRouter.get('/portfolio/:id/risk-diagnostics', async (req: Request, res: Response) => {
    try {
        const portfolioId = req.params.id
        if (!portfolioId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Portfolio ID required')
        }

        let portfolio: any
        try {
            portfolio = await stellarService.getPortfolio(portfolioId)
        } catch (error) {
            const errMsg = getErrorMessage(error)
            if (errMsg.includes('Portfolio not found')) {
                return fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
            }
            throw error
        }

        const prices = await reflectorService.getCurrentPrices()
        const riskHeatmap = riskManagementService.calculateRiskHeatmap(portfolio.allocations, prices)

        return ok(res, { riskHeatmap })
    } catch (error) {
        logger.error('[ERROR] Get portfolio risk diagnostics failed', { error: getErrorObject(error), portfolioId: req.params.id })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
