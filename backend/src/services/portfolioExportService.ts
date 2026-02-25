import type { Portfolio } from '../types/index.js'
import type { RebalanceEvent } from './rebalanceHistory.js'
import { portfolioStorage } from './portfolioStorage.js'
import { rebalanceHistoryService } from './serviceContainer.js'
import { ReflectorService } from './reflector.js'
import PDFDocument from 'pdfkit'
import { logger } from '../utils/logger.js'

const EXPORT_HISTORY_LIMIT = 10_000

export interface ExportJsonPayload {
    exportedAt: string
    portfolioId: string
    portfolio: Portfolio
    rebalanceHistory: RebalanceEvent[]
    meta: { format: 'json'; purpose: 'GDPR data export' }
}

export function buildExportJson(
    portfolio: Portfolio,
    history: RebalanceEvent[]
): ExportJsonPayload {
    return {
        exportedAt: new Date().toISOString(),
        portfolioId: portfolio.id,
        portfolio,
        rebalanceHistory: history,
        meta: { format: 'json', purpose: 'GDPR data export' }
    }
}

const csvEscape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
}

export function buildExportCsv(history: RebalanceEvent[]): string {
    const headers = [
        'id', 'portfolioId', 'timestamp', 'trigger', 'trades', 'gasUsed', 'status',
        'eventSource', 'onChainTxHash', 'isAutomatic', 'fromAsset', 'toAsset', 'amount'
    ]
    const rows = history.map((e) => [
        e.id,
        e.portfolioId,
        e.timestamp,
        e.trigger,
        e.trades,
        e.gasUsed,
        e.status,
        e.eventSource ?? '',
        e.onChainTxHash ?? '',
        e.isAutomatic ? 'true' : 'false',
        e.details?.fromAsset ?? '',
        e.details?.toAsset ?? '',
        e.details?.amount ?? ''
    ])
    const head = headers.join(',')
    const body = rows.map((r) => r.map(csvEscape).join(',')).join('\n')
    return `${head}\n${body}\n`
}

export async function buildExportPdf(
    portfolio: Portfolio,
    history: RebalanceEvent[],
    prices?: Record<string, { price?: number }>
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 })
        const chunks: Buffer[] = []
        doc.on('data', (chunk: Buffer) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const exportedAt = new Date().toISOString()

        doc.fontSize(18).text('Portfolio Export Report', { align: 'center' })
        doc.moveDown(0.5)
        doc.fontSize(10).text(`Portfolio ID: ${portfolio.id}`, { align: 'center' })
        doc.text(`Exported: ${exportedAt}`, { align: 'center' })
        doc.moveDown(1)

        doc.fontSize(14).text('Portfolio summary', { underline: true })
        doc.fontSize(10)
        doc.text(`User address: ${portfolio.userAddress}`)
        doc.text(`Created: ${portfolio.createdAt}`)
        doc.text(`Last rebalance: ${portfolio.lastRebalance}`)
        doc.text(`Threshold: ${portfolio.threshold}%`)
        if (portfolio.slippageTolerance != null) {
            doc.text(`Slippage tolerance: ${portfolio.slippageTolerance}%`)
        }
        if (portfolio.strategy) {
            doc.text(`Strategy: ${portfolio.strategy}`)
        }
        doc.moveDown(0.5)

        doc.text('Target allocations:')
        for (const [asset, pct] of Object.entries(portfolio.allocations || {})) {
            doc.text(`  ${asset}: ${pct}%`)
        }
        doc.moveDown(0.5)

        if (portfolio.balances && Object.keys(portfolio.balances).length > 0) {
            doc.text('Balances:')
            for (const [asset, bal] of Object.entries(portfolio.balances)) {
                const price = prices?.[asset]?.price
                const value = price != null ? bal * price : null
                doc.text(`  ${asset}: ${bal}${value != null ? ` (≈ $${value.toFixed(2)})` : ''}`)
            }
            doc.moveDown(0.5)
        }

        if (portfolio.totalValue != null) {
            doc.text(`Total value (at export): $${portfolio.totalValue.toFixed(2)}`)
        }
        doc.moveDown(1)

        doc.fontSize(14).text('Rebalance history (transaction history)', { underline: true })
        doc.fontSize(10)

        if (history.length === 0) {
            doc.text('No rebalance events recorded.')
        } else {
            const tableTop = doc.y
            const colWidths = [90, 100, 80, 50, 70]
            const headers = ['Date', 'Trigger', 'Trades', 'Status', 'Gas']
            doc.font('Helvetica-Bold')
            let x = 50
            headers.forEach((h, i) => {
                doc.text(h, x, tableTop, { width: colWidths[i] })
                x += colWidths[i]
            })
            doc.moveDown(0.3)
            doc.font('Helvetica')
            history.slice(0, 50).forEach((e) => {
                const y = doc.y
                if (y > 700) {
                    doc.addPage()
                }
                x = 50
                const row = [
                    e.timestamp.slice(0, 19),
                    (e.trigger || '').slice(0, 28),
                    String(e.trades),
                    e.status,
                    (e.gasUsed || '').slice(0, 14)
                ]
                row.forEach((cell, i) => {
                    doc.text(String(cell), x, doc.y, { width: colWidths[i] })
                    x += colWidths[i]
                })
                doc.moveDown(0.25)
            })
            if (history.length > 50) {
                doc.moveDown(0.3)
                doc.text(`… and ${history.length - 50} more events (full history in JSON/CSV export).`)
            }
        }

        doc.moveDown(1)
        doc.fontSize(9).text('This report was generated for GDPR data portability. Include portfolio ID and export timestamp when contacting support.', {
            align: 'center'
        })

        doc.end()
    })
}

export interface ExportResult {
    contentType: string
    filename: string
    body: string | Buffer
}

export async function getPortfolioExport(
    portfolioId: string,
    format: 'json' | 'csv' | 'pdf'
): Promise<ExportResult | null> {
    const portfolio = await portfolioStorage.getPortfolio(portfolioId)
    if (!portfolio) return null

    const history = await rebalanceHistoryService.getRebalanceHistory(portfolioId, EXPORT_HISTORY_LIMIT)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safeId = portfolioId.slice(0, 8)

    if (format === 'json') {
        const payload = buildExportJson(portfolio, history)
        return {
            contentType: 'application/json; charset=utf-8',
            filename: `portfolio_${safeId}_${timestamp}.json`,
            body: JSON.stringify(payload, null, 2)
        }
    }

    if (format === 'csv') {
        const csv = buildExportCsv(history)
        return {
            contentType: 'text/csv; charset=utf-8',
            filename: `portfolio_${safeId}_rebalance_history_${timestamp}.csv`,
            body: csv
        }
    }

    if (format === 'pdf') {
        let prices: Record<string, { price?: number }> = {}
        try {
            const reflector = new ReflectorService()
            const p = await reflector.getCurrentPrices()
            prices = p as Record<string, { price?: number }>
        } catch (err) {
            logger.warn('Export PDF: could not fetch prices', { error: err })
        }
        const buffer = await buildExportPdf(portfolio, history, prices)
        return {
            contentType: 'application/pdf',
            filename: `portfolio_${safeId}_report_${timestamp}.pdf`,
            body: buffer
        }
    }

    return null
}
