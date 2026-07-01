import type { Request, Response } from 'express'
import { Router } from 'express'

import { StellarService } from '../services/stellar.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { logger } from '../utils/logger.js'
import { ok, fail } from '../utils/apiResponse.js'
import { buildAllocationsFromAnyPayload } from '../services/portfolioImportService.js'

import { failValidation } from './bulkImportValidation.js'


const stellarService = new StellarService()

export const portfolioImportRouter = Router()

// POST /api/v1/portfolio/import
// Accepts JSON or CSV.
// JSON examples:
//   { "allocations": [ { "asset": "USDC", "allocation_pct": 50 }, ... ] }
//   [ { "asset": "USDC", "allocation_pct": 50 }, ... ]
//
// CSV examples (headers required):
//   asset,allocation_pct\nUSDC,50\nXLM,50
portfolioImportRouter.post('/portfolio/import', async (req: Request, res: Response) => {
  try {
    // Determine content-type + body type.
    const contentType = (req.headers['content-type'] ?? '').toString()

    // If content-type is text/csv we might receive string (if upstream doesn't parse).
    // If json, req.body is parsed by express.json().
    // Parse + validate.
    const { allocations, validationError } = await buildAllocationsFromAnyPayload({
      body: req.body,
      contentType,
    })

    if (!allocations) {
      if (validationError) return failValidation(res, validationError)
      return fail(res, 400, 'VALIDATION_ERROR', 'Invalid import payload')
    }

    const parsedAllocations = allocations

    // Create new portfolio.
    // Task spec: endpoint creates a new portfolio from imported allocations.
    // For threshold/slippage/strategy, reuse existing createPortfolio defaults.
    // If auth is enabled, require req.user.
    const userAddress = (req.user as any)?.address ?? (req.body?.userAddress as string | undefined)
    if (!userAddress || typeof userAddress !== 'string' || userAddress.trim().length === 0) {
      return fail(res, 400, 'VALIDATION_ERROR', 'userAddress is required')
    }

    const portfolioId = await stellarService.createPortfolio(
      userAddress,
      parsedAllocations,
      5,
      1,
      'threshold',
      {},
      typeof req.body?.name === 'string' ? req.body.name : undefined,
      typeof req.body?.description === 'string' ? req.body.description : undefined
    )

    return ok(res, { portfolioId, status: 'created' }, { status: 201 })
  } catch (error) {
    logger.error('[ERROR] Bulk portfolio import failed', { error })
    return fail(res, 500, 'INTERNAL_ERROR', 'Bulk import failed')
  }
})

