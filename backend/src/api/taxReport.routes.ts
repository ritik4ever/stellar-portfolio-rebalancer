import { Router, Request, Response } from 'express'
import { databaseService } from '../services/databaseService.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const taxReportRouter = Router()

export type CostBasisMethod = 'fifo' | 'lifo' | 'hifo'

export const COST_BASIS_METHODS: CostBasisMethod[] = ['fifo', 'lifo', 'hifo']

const METHODOLOGY_DESCRIPTIONS: Record<CostBasisMethod, string> = {
  fifo:
    'FIFO (first-in, first-out). Each rebalance buys one asset and sells another. ' +
    'Sell cost basis is determined by consuming the oldest tax lots first. ' +
    'Buy events create new tax lots at the purchase price.',
  lifo:
    'LIFO (last-in, first-out). Each rebalance buys one asset and sells another. ' +
    'Sell cost basis is determined by consuming the most recently acquired tax lots first. ' +
    'Buy events create new tax lots at the purchase price.',
  hifo:
    'HIFO (highest-in, first-out). Each rebalance buys one asset and sells another. ' +
    'Sell cost basis is determined by consuming the tax lots with the highest unit cost first, ' +
    'which minimises realized gains. Buy events create new tax lots at the purchase price.',
}

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
 * A single lot-level disposal produced while matching a sell against tax lots.
 * One sell can produce several disposals when it spans multiple lots.
 * This is the granularity required by consumer tax software (TurboTax et al.),
 * which needs an acquisition date per disposed lot.
 */
interface TaxDisposal {
  asset: string
  acquiredDate: string
  soldDate: string
  amount: number
  costBasis: number
  proceeds: number
  realizedGainLoss: number
}

interface TaxReportResult {
  entries: TaxReportEntry[]
  disposals: TaxDisposal[]
}

const DUST = 0.00000001

/**
 * Cost-basis lot matching.
 *
 * Every "buy" creates a tax lot (asset, date, amount, unit price, total cost basis).
 * When the same asset is later sold, lots are consumed in an order determined by the
 * selected cost-basis method:
 *
 *   - FIFO: oldest lot first (chronological)
 *   - LIFO: most recently acquired lot first
 *   - HIFO: highest unit cost first (ties broken by the older lot)
 *
 * The cost basis taken from each lot is proportional to the amount consumed.
 * Realized gain/loss = (sell price × sell amount) − matched cost basis.
 *
 * Only completed rebalance events with trade details (fromAsset, toAsset, amount)
 * are included. Events without explicit trade details are skipped.
 */
export function computeReport(events: any[], method: CostBasisMethod = 'fifo'): TaxReportResult {
  const lots: Map<string, TaxLot[]> = new Map()
  const entries: TaxReportEntry[] = []
  const disposals: TaxDisposal[] = []

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

    // Sell fromAsset (consume lots in method order, compute realized gain/loss)
    let remainingToSell = amount
    let totalCostBasisForSell = 0
    const assetLots = lots.get(fromAsset) ?? []

    while (remainingToSell > DUST && assetLots.length > 0) {
      const lotIndex = selectLotIndex(assetLots, method)
      const lot = assetLots[lotIndex]
      const consumed = Math.min(remainingToSell, lot.amount)
      const costBasisFraction = (consumed / lot.amount) * lot.costBasis

      totalCostBasisForSell += costBasisFraction
      lot.amount -= consumed
      lot.costBasis -= costBasisFraction
      remainingToSell -= consumed

      disposals.push({
        asset: fromAsset,
        acquiredDate: lot.date,
        soldDate: date,
        amount: consumed,
        costBasis: costBasisFraction,
        proceeds: consumed * fromPrice,
        realizedGainLoss: consumed * fromPrice - costBasisFraction,
      })

      if (lot.amount <= DUST) {
        assetLots.splice(lotIndex, 1)
      }
    }

    if (remainingToSell > DUST) {
      // No cost basis available — treat cost basis as 0
      disposals.push({
        asset: fromAsset,
        acquiredDate: date,
        soldDate: date,
        amount: remainingToSell,
        costBasis: 0,
        proceeds: remainingToSell * fromPrice,
        realizedGainLoss: remainingToSell * fromPrice,
      })
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

  return { entries, disposals }
}

/**
 * Pick which lot to consume next. Lots are stored in acquisition order, so
 * FIFO is the head and LIFO is the tail. HIFO scans for the highest unit cost,
 * keeping the earlier lot on a tie so results stay deterministic.
 */
function selectLotIndex(lots: TaxLot[], method: CostBasisMethod): number {
  if (method === 'lifo') return lots.length - 1
  if (method === 'fifo') return 0

  let bestIndex = 0
  let bestUnitCost = unitCost(lots[0])
  for (let i = 1; i < lots.length; i++) {
    const cost = unitCost(lots[i])
    if (cost > bestUnitCost) {
      bestUnitCost = cost
      bestIndex = i
    }
  }
  return bestIndex
}

function unitCost(lot: TaxLot): number {
  return lot.amount > 0 ? lot.costBasis / lot.amount : lot.price
}

export function parseCostBasisMethod(raw: unknown): CostBasisMethod | null {
  if (raw === undefined || raw === null || raw === '') return 'fifo'
  if (typeof raw !== 'string') return null
  const normalized = raw.toLowerCase().trim() as CostBasisMethod
  return COST_BASIS_METHODS.includes(normalized) ? normalized : null
}

function getPriceEstimate(asset: string, date: string): number {
  // Prefer the price as of the trade date so historical lots keep their own
  // acquisition price — this is what makes FIFO/LIFO/HIFO diverge.
  const asOf = (databaseService as any).getPriceSnapshotAsOf
  if (typeof asOf === 'function' && date) {
    const historical = asOf.call(databaseService, asset, date)
    if (historical && historical.price > 0) {
      return historical.price
    }
  }

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

/**
 * TurboTax cryptocurrency CSV import schema — column order is fixed and must
 * match exactly for the import template to be accepted:
 *
 *   Currency Name, Purchase Date, Cost Basis, Date Sold, Proceeds
 *
 * Dates are MM/DD/YYYY and monetary amounts are plain decimals with no
 * currency symbol or thousands separators. One row per disposed lot.
 */
export const TURBOTAX_HEADERS = [
  'Currency Name',
  'Purchase Date',
  'Cost Basis',
  'Date Sold',
  'Proceeds',
] as const

export function toTurboTaxCSV(disposals: TaxDisposal[]): string {
  const rows = disposals.map((d) =>
    [
      escapeCsv(d.asset),
      formatTurboTaxDate(d.acquiredDate),
      d.costBasis.toFixed(2),
      formatTurboTaxDate(d.soldDate),
      d.proceeds.toFixed(2),
    ].join(','),
  )

  return [TURBOTAX_HEADERS.join(','), ...rows].join('\n')
}

function formatTurboTaxDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getUTCFullYear()}`
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

taxReportRouter.get('/portfolio/tax-report', (req: Request, res: Response) => {
  try {
    const yearParam = req.query.year as string | undefined
    const rawFormat = (req.query.format as string)?.toLowerCase()
    const format = rawFormat === 'csv' ? 'csv' : rawFormat === 'turbotax' ? 'turbotax' : 'json'
    const taxYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()

    if (isNaN(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return fail(res, 400, 'VALIDATION_ERROR', 'Invalid year. Use a year between 2000 and 2100.')
    }

    const method = parseCostBasisMethod(req.query.costBasisMethod)
    if (!method) {
      return fail(
        res,
        400,
        'VALIDATION_ERROR',
        `Invalid costBasisMethod. Use one of: ${COST_BASIS_METHODS.join(', ')}.`,
      )
    }

    const startDate = new Date(Date.UTC(taxYear, 0, 1)).toISOString()
    const endDate = new Date(Date.UTC(taxYear + 1, 0, 1)).toISOString()

    const events = databaseService.getRebalanceHistoryByDateRange(startDate, endDate)
    const { entries, disposals } = computeReport(events, method)

    if (format === 'turbotax') {
      const csv = toTurboTaxCSV(disposals)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="turbotax-tax-report-${taxYear}-${method}.csv"`,
      )
      return res.status(200).send(csv)
    }

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
      costBasisMethod: method,
      totalRealizedGainLoss: entries.reduce((sum, e) => sum + e.realizedGainLoss, 0),
      totalTrades: entries.length,
      entries,
      disposals,
      methodology: METHODOLOGY_DESCRIPTIONS[method],
    }

    return ok(res, summary)
  } catch (error) {
    logger.error('Failed to generate tax report', { error: getErrorObject(error) })
    return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
  }
})
