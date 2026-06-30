import { Router, Request, Response } from 'express'
import { databaseService } from '../services/databaseService.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const taxReportRouter = Router()

interface TaxLot {
  asset: string
  date: string
  amount: number
  price: number
  costBasis: number
}

interface TaxReportEntry {
  asset: string
  date: string
  type: 'buy' | 'sell'
  amount: number
  price: number
  costBasis: number
  realizedGainLoss: number
}

/**
 * FIFO methodology:
 *
 * Every "buy" creates a tax lot (asset, date, amount, unit price, total cost basis).
 * When the same asset is later sold, lots are consumed in chronological order
 * (first-in, first-out). The cost basis for each lot is proportional to the
 * amount consumed. Realized gain/loss = (sell price × sell amount) − cost basis.
 *
 * Only completed rebalance events with trade details (fromAsset, toAsset, amount)
 * are included. Events without explicit trade details are skipped.
 */

function fifoComputeReport(events: any[]): TaxReportEntry[] {
  const lots: Map<string, TaxLot[]> = new Map()
  const entries: TaxReportEntry[] = []

  for (const event of events) {
    const details = event.details
    if (!details?.fromAsset || !details?.toAsset || details.amount == null) {
      continue
    }

    const fromAsset = details.fromAsset as string
    const toAsset = details.toAsset as string
    const amount = Number(details.amount)
    const date = event.timestamp

    const fromPrice = getPriceEstimate(fromAsset, date)
    const toPrice = getPriceEstimate(toAsset, date)

    if (fromPrice <= 0 || toPrice <= 0 || amount <= 0) {
      continue
    }

    const toAmount = (amount * fromPrice) / toPrice

    // Sell fromAsset (consume FIFO lots, compute realized gain/loss)
    let remainingToSell = amount
    let totalCostBasisForSell = 0
    const assetLots = lots.get(fromAsset) ?? []

    while (remainingToSell > 0 && assetLots.length > 0) {
      const lot = assetLots[0]
      const consumed = Math.min(remainingToSell, lot.amount)
      const costBasisFraction = (consumed / lot.amount) * lot.costBasis

      totalCostBasisForSell += costBasisFraction
      lot.amount -= consumed
      lot.costBasis -= costBasisFraction
      remainingToSell -= consumed

      if (lot.amount <= 0.00000001) {
        assetLots.shift()
      }
    }

    if (remainingToSell > 0 && assetLots.length === 0) {
      // No cost basis available — treat cost basis as 0
      totalCostBasisForSell += 0
    }

    const sellValue = amount * fromPrice
    const realizedGainLoss = sellValue - totalCostBasisForSell

    entries.push({
      asset: fromAsset,
      date,
      type: 'sell',
      amount,
      price: fromPrice,
      costBasis: totalCostBasisForSell,
      realizedGainLoss,
    })

    lots.set(fromAsset, assetLots)

    // Buy toAsset (add new tax lot)
    const buyCostBasis = toAmount * toPrice
    const toLots = lots.get(toAsset) ?? []
    toLots.push({
      asset: toAsset,
      date,
      amount: toAmount,
      price: toPrice,
      costBasis: buyCostBasis,
    })
    lots.set(toAsset, toLots)

    entries.push({
      asset: toAsset,
      date,
      type: 'buy',
      amount: toAmount,
      price: toPrice,
      costBasis: buyCostBasis,
      realizedGainLoss: 0,
    })
  }

  return entries
}

function getPriceEstimate(asset: string, _date: string): number {
  const snapshot = databaseService.getLatestPriceSnapshot(asset)
  if (snapshot && snapshot.price > 0) {
    return snapshot.price
  }

  const fallback: Record<string, number> = {
    XLM: 0.45,
    USDC: 1.0,
    BTC: 85000,
    ETH: 3400,
    yXLM: 0.47,
    AQUA: 0.001,
  }

  return fallback[asset] ?? 1.0
}

function toCSV(entries: TaxReportEntry[]): string {
  const headers = [
    'asset',
    'date',
    'type',
    'amount',
    'price',
    'cost_basis',
    'realized_gain_loss',
  ].join(',')

  const rows = entries.map((e) =>
    [
      e.asset,
      e.date,
      e.type,
      e.amount.toFixed(8),
      e.price.toFixed(8),
      e.costBasis.toFixed(8),
      e.realizedGainLoss.toFixed(8),
    ].join(','),
  )

  return [headers, ...rows].join('\n')
}

taxReportRouter.get('/tax-report', (req: Request, res: Response) => {
  try {
    const yearParam = req.query.year as string | undefined
    const format = (req.query.format as string)?.toLowerCase() === 'csv' ? 'csv' : 'json'
    const taxYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()

    if (isNaN(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return fail(res, 400, 'VALIDATION_ERROR', 'Invalid year. Use a year between 2000 and 2100.')
    }

    const startDate = new Date(Date.UTC(taxYear, 0, 1)).toISOString()
    const endDate = new Date(Date.UTC(taxYear + 1, 0, 1)).toISOString()

    const events = databaseService.getRebalanceHistoryByDateRange(startDate, endDate)
    const entries = fifoComputeReport(events)

    if (format === 'csv') {
      const csv = toCSV(entries)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="sanctifier-tax-report-${taxYear}.csv"`,
      )
      return res.status(200).send(csv)
    }

    const summary = {
      taxYear,
      totalRealizedGainLoss: entries.reduce((sum, e) => sum + e.realizedGainLoss, 0),
      totalTrades: entries.length,
      entries,
      methodology: 'FIFO (first-in, first-out). Each rebalance buys one asset and sells another. ' +
        'Sell cost basis is determined by consuming the oldest tax lots first. ' +
        'Buy events create new tax lots at the purchase price.',
    }

    return ok(res, summary)
  } catch (error) {
    logger.error('Failed to generate tax report', { error: getErrorObject(error) })
    return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
  }
})
