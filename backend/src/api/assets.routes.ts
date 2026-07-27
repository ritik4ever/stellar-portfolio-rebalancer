import { Router, Request, Response } from 'express'
import { assetRegistryService } from '../services/assetRegistryService.js'
import {
    AssetRegistryConflictError,
    AssetRegistryValidationError
} from '../services/assetRegistryValidation.js'
import { rateLimitMonitor } from '../services/rateLimitMonitor.js'
import { requireAdmin } from '../middleware/auth.js'
import { adminRateLimiter } from '../middleware/rateLimit.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { validateRequest } from '../middleware/validate.js'
import { adminAddAssetSchema, adminPatchAssetSchema, assetsListQuerySchema } from './validation.js'
import { logger, logAudit } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const assetsRouter = Router()

/**
 * Public: browse the asset catalog with pagination, sorting, and
 * issuer/symbol filtering. Defaults to enabled assets only, sorted by symbol.
 */
assetsRouter.get('/assets', (req: Request, res: Response) => {
    try {
        const parsed = assetsListQuerySchema.safeParse(req.query)
        if (!parsed.success) {
            const message = parsed.error.issues
                .map(issue => `${issue.path.join('.') || 'query'}: ${issue.message}`)
                .join('; ')
            logger.warn('[WARN] List assets rejected invalid query', { query: req.query, message })
            return fail(res, 400, 'VALIDATION_ERROR', message)
        }

        const { enabledOnly, code, search, q, issuer, sortBy, order, page, limit } = parsed.data

        const result = assetRegistryService.query({
            enabledOnly: enabledOnly !== false,
            search: code || search || q,
            issuer,
            sortBy,
            order,
            page,
            limit
        })

        return ok(res, result)
    } catch (error) {
        logger.error('[ERROR] List assets failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Public: get asset by symbol */
assetsRouter.get('/assets/:id', (req: Request, res: Response) => {
    try {
        const id = req.params.id?.trim()
        if (!id) return fail(res, 400, 'VALIDATION_ERROR', 'Asset id is required')

        const asset = assetRegistryService.getBySymbol(id)
        if (!asset || !asset.enabled) return fail(res, 404, 'NOT_FOUND', 'Asset not found')

        return ok(res, { asset })
    } catch (error) {
        logger.error('[ERROR] Get asset failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Admin: list all assets (including disabled) */
assetsRouter.get('/admin/assets', requireAdmin, (req: Request, res: Response) => {
    try {
        const assets = assetRegistryService.list(false)
        return ok(res, { assets })
    } catch (error) {
        logger.error('[ERROR] Admin list assets failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Admin: get rate limiting metrics and monitoring data */
assetsRouter.get('/admin/rate-limits/metrics', requireAdmin, (req: Request, res: Response) => {
    try {
        const metrics = rateLimitMonitor.getMetrics()
        const topOffendersByIP = rateLimitMonitor.getTopOffendersByIP(10)
        const topOffendersByUser = rateLimitMonitor.getTopOffendersByUser(10)
        const throttlingByEndpoint = rateLimitMonitor.getThrottlingByEndpoint()

        return ok(res, {
            metrics,
            topOffendersByIP,
            topOffendersByUser,
            throttlingByEndpoint,
            report: rateLimitMonitor.generateReport()
        })
    } catch (error) {
        logger.error('[ERROR] Admin rate limit metrics failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Admin: add asset */
assetsRouter.post('/admin/assets', requireAdmin, idempotencyMiddleware, validateRequest(adminAddAssetSchema), async (req: Request, res: Response) => {
    try {
        const { symbol, name, contractAddress, issuerAccount, coingeckoId } = req.body
        await assetRegistryService.add(
            symbol,
            name,
            {
                contractAddress,
                issuerAccount,
                coingeckoId
            }
        )
        const parsedSymbol =
            typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
        const asset = assetRegistryService.getBySymbol(parsedSymbol)
        if (asset) {
            const auditFields: Record<string, unknown> = {
                domain: 'asset_registry',
                actorPublicKey: req.adminPublicKey,
                symbol: asset.symbol,
                name: asset.name,
                enabled: asset.enabled
            }
            if (asset.coingeckoId) auditFields.coingeckoId = asset.coingeckoId
            if (asset.contractAddress) auditFields.contractAddress = asset.contractAddress
            if (asset.issuerAccount) auditFields.issuerAccount = asset.issuerAccount
            logAudit('asset_registry_asset_created', auditFields)
        }
        return ok(res, { asset }, { status: 201 })
    } catch (error) {
        if (error instanceof AssetRegistryValidationError) {
            return fail(res, 400, 'VALIDATION_ERROR', error.message)
        }
        if (error instanceof AssetRegistryConflictError) {
            return fail(res, 409, 'ASSET_CONFLICT', error.message)
        }
        logger.error('[ERROR] Admin add asset failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Admin: remove asset */
assetsRouter.delete('/admin/assets/:symbol', requireAdmin, async (req: Request, res: Response) => {
    try {
        const symbol = req.params.symbol
        if (!symbol) return fail(res, 400, 'VALIDATION_ERROR', 'symbol is required')
        const prior = assetRegistryService.getBySymbol(symbol)
        const removed = assetRegistryService.remove(symbol)
        if (!removed) return fail(res, 404, 'NOT_FOUND', 'Asset not found')
        if (prior) {
            const auditFields: Record<string, unknown> = {
                domain: 'asset_registry',
                actorPublicKey: req.adminPublicKey,
                symbol: prior.symbol,
                name: prior.name,
                enabled: prior.enabled
            }
            if (prior.coingeckoId) auditFields.coingeckoId = prior.coingeckoId
            if (prior.contractAddress) auditFields.contractAddress = prior.contractAddress
            if (prior.issuerAccount) auditFields.issuerAccount = prior.issuerAccount
            logAudit('asset_registry_asset_removed', auditFields)
        }
        return ok(res, { message: 'Asset removed' })
    } catch (error) {
        logger.error('[ERROR] Admin remove asset failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Admin: patch asset attributes */
assetsRouter.patch('/admin/assets/:symbol', requireAdmin, adminRateLimiter, validateRequest(adminPatchAssetSchema), async (req: Request, res: Response) => {
    try {
        const symbol = req.params.symbol
        const { enabled, quarantined } = req.body
        const prior = assetRegistryService.getBySymbol(symbol)
        if (!prior) return fail(res, 404, 'NOT_FOUND', 'Asset not found')

        if (enabled !== undefined) {
            assetRegistryService.setEnabled(symbol, enabled)
            logAudit('asset_registry_asset_updated', {
                domain: 'asset_registry',
                actorPublicKey: req.adminPublicKey,
                symbol: prior.symbol,
                field: 'enabled',
                previousValue: prior.enabled,
                newValue: enabled
            })
        }

        if (quarantined !== undefined) {
            assetRegistryService.setQuarantined(symbol, quarantined)
            logAudit('asset_registry_asset_updated', {
                domain: 'asset_registry',
                actorPublicKey: req.adminPublicKey,
                symbol: prior.symbol,
                field: 'quarantined',
                previousValue: prior.isQuarantined,
                newValue: quarantined
            })
        }

        const asset = assetRegistryService.getBySymbol(symbol)
        return ok(res, { asset })
    } catch (error) {
        logger.error('[ERROR] Admin set asset attributes failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Admin: refresh specific asset source */
assetsRouter.post('/admin/assets/:symbol/refresh', requireAdmin, adminRateLimiter, async (req: Request, res: Response) => {
    try {
        const symbol = req.params.symbol
        const prior = assetRegistryService.getBySymbol(symbol)
        if (!prior) return fail(res, 404, 'NOT_FOUND', 'Asset not found')

        const success = await assetRegistryService.refreshAssetSource(symbol)
        const asset = assetRegistryService.getBySymbol(symbol)

        logAudit('asset_registry_source_refreshed', {
            domain: 'asset_registry',
            actorPublicKey: req.adminPublicKey,
            symbol,
            success
        })

        return ok(res, { symbol, success, asset })
    } catch (error) {
        logger.error('[ERROR] Admin refresh asset failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Admin: batch refresh all asset sources */
assetsRouter.post('/admin/assets/refresh', requireAdmin, adminRateLimiter, async (req: Request, res: Response) => {
    try {
        const results = await assetRegistryService.refreshAllAssetSources()

        logAudit('asset_registry_batch_refreshed', {
            domain: 'asset_registry',
            actorPublicKey: req.adminPublicKey,
            count: Object.keys(results).length
        })

        return ok(res, { results })
    } catch (error) {
        logger.error('[ERROR] Admin batch refresh failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
