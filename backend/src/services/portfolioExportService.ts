import type { Portfolio } from '../types/index.js'
import type { RebalanceEvent } from './rebalanceHistory.js'
import { portfolioStorage } from './portfolioStorage.js'
import { rebalanceHistoryService } from './serviceContainer.js'
import { ReflectorService } from './reflector.js'
import PDFDocument from 'pdfkit'
import { logger } from '../utils/logger.js'
import {
    dbDeleteExportSchedule,
    dbGetExportSchedule,
    dbListDueExportSchedules,
    dbListExportSchedulesForUser,
    dbRecordExportScheduleRun,
    dbUpsertExportSchedule,
    WEEK_MS,
    type ExportSchedule,
    type ExportScheduleFrequency,
} from '../db/exportScheduleDb.js'

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
            filename: `portfolio-${safeId}-export-${timestamp}.json`,
            body: JSON.stringify(payload, null, 2)
        }
    }

    if (format === 'csv') {
        const csv = buildExportCsv(history)
        return {
            contentType: 'text/csv; charset=utf-8',
            filename: `portfolio-${safeId}-export-${timestamp}.csv`,
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
            filename: `portfolio-${safeId}-export-${timestamp}.pdf`,
            body: buffer
        }
    }

    return null
}

// ── recurring scheduled exports (#1411) ──────────────────────────────────────

export interface SetExportScheduleInput {
    portfolioId: string
    userAddress: string
    emailAddress: string
    frequency?: ExportScheduleFrequency
    enabled?: boolean
    /** First delivery time; defaults to one period from now. */
    firstRunAt?: string
}

export interface ScheduledExportRunResult {
    portfolioId: string
    status: 'sent' | 'skipped' | 'failed'
    reason?: string
    filename?: string
    emailedTo?: string
}

/**
 * Opt a portfolio into (or out of) a recurring emailed export.
 * Only weekly CSV is supported today; the storage shape leaves room for more.
 */
export function setExportSchedule(input: SetExportScheduleInput): ExportSchedule {
    const schedule = dbUpsertExportSchedule({
        portfolioId: input.portfolioId,
        userAddress: input.userAddress,
        emailAddress: input.emailAddress,
        frequency: input.frequency ?? 'weekly',
        format: 'csv',
        enabled: input.enabled,
        nextRunAt: input.firstRunAt,
    })

    logger.info('[EXPORT-SCHEDULE] Schedule saved', {
        portfolioId: schedule.portfolioId,
        frequency: schedule.frequency,
        enabled: schedule.enabled,
        nextRunAt: schedule.nextRunAt,
    })

    return schedule
}

export function getExportSchedule(portfolioId: string): ExportSchedule | undefined {
    return dbGetExportSchedule(portfolioId)
}

export function listExportSchedulesForUser(userAddress: string): ExportSchedule[] {
    return dbListExportSchedulesForUser(userAddress)
}

export function deleteExportSchedule(portfolioId: string): boolean {
    return dbDeleteExportSchedule(portfolioId)
}

export function listDueExportSchedules(asOf?: string): ExportSchedule[] {
    return dbListDueExportSchedules(asOf)
}

/**
 * Generate and email one scheduled export.
 *
 * The CSV is produced by the same `getPortfolioExport` path the on-demand export
 * endpoint uses — no duplicated generation logic — and delivered through the
 * existing notification email provider as an attachment. The schedule's cursor is
 * advanced whether the run succeeded or failed, so one bad run cannot wedge the
 * schedule into retrying forever.
 */
export async function runScheduledExport(
    schedule: ExportSchedule,
): Promise<ScheduledExportRunResult> {
    try {
        const result = await getPortfolioExport(schedule.portfolioId, schedule.format)

        if (!result) {
            // The portfolio is gone — disable rather than fail on every tick.
            dbUpsertExportSchedule({
                portfolioId: schedule.portfolioId,
                userAddress: schedule.userAddress,
                emailAddress: schedule.emailAddress,
                frequency: schedule.frequency,
                format: schedule.format,
                enabled: false,
                nextRunAt: schedule.nextRunAt,
            })
            dbRecordExportScheduleRun(schedule.portfolioId, {
                status: 'failed',
                error: 'portfolio_not_found',
                nextRunAt: schedule.nextRunAt,
            })
            logger.warn('[EXPORT-SCHEDULE] Portfolio not found — schedule disabled', {
                portfolioId: schedule.portfolioId,
            })
            return { portfolioId: schedule.portfolioId, status: 'skipped', reason: 'portfolio_not_found' }
        }

        const body = typeof result.body === 'string' ? result.body : result.body.toString('utf8')

        // Imported lazily: the notification service pulls in the database and
        // SMTP stack, which the on-demand export paths have no need to load.
        const { notificationService } = await import('./notificationService.js')

        await notificationService.sendEmailWithAttachment({
            to: schedule.emailAddress,
            subject: `[Stellar Portfolio] Your ${schedule.frequency} portfolio export`,
            text: buildScheduledExportText(schedule, result.filename),
            html: buildScheduledExportHtml(schedule, result.filename),
            attachments: [
                {
                    filename: result.filename,
                    content: body,
                    contentType: result.contentType,
                },
            ],
        })

        dbRecordExportScheduleRun(schedule.portfolioId, {
            status: 'success',
            nextRunAt: nextRunFor(schedule.frequency),
        })

        logger.info('[EXPORT-SCHEDULE] Export emailed', {
            portfolioId: schedule.portfolioId,
            filename: result.filename,
        })

        return {
            portfolioId: schedule.portfolioId,
            status: 'sent',
            filename: result.filename,
            emailedTo: schedule.emailAddress,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        dbRecordExportScheduleRun(schedule.portfolioId, {
            status: 'failed',
            error: message,
            nextRunAt: nextRunFor(schedule.frequency),
        })
        logger.error('[EXPORT-SCHEDULE] Export run failed', {
            portfolioId: schedule.portfolioId,
            error: message,
        })
        return { portfolioId: schedule.portfolioId, status: 'failed', reason: message }
    }
}

/** Run every schedule that is currently due. */
export async function runDueExportSchedules(
    asOf?: string,
): Promise<ScheduledExportRunResult[]> {
    const due = listDueExportSchedules(asOf)
    if (due.length === 0) return []

    logger.info('[EXPORT-SCHEDULE] Processing due schedules', { count: due.length })

    const results: ScheduledExportRunResult[] = []
    for (const schedule of due) {
        results.push(await runScheduledExport(schedule))
    }
    return results
}

function nextRunFor(_frequency: ExportScheduleFrequency): string {
    return new Date(Date.now() + WEEK_MS).toISOString()
}

function buildScheduledExportText(schedule: ExportSchedule, filename: string): string {
    return `
Your ${schedule.frequency} portfolio export is attached.

Portfolio: ${schedule.portfolioId}
File: ${filename}
Generated: ${new Date().toISOString()}

To change or stop these emails, update the export schedule for this portfolio in the app.

---
Stellar Portfolio Rebalancer
    `.trim()
}

function buildScheduledExportHtml(schedule: ExportSchedule, filename: string): string {
    return `
<!DOCTYPE html>
<html>
  <body style="font-family: system-ui, sans-serif; color: #111;">
    <h2 style="margin-bottom: 4px;">Your ${schedule.frequency} portfolio export</h2>
    <p style="color: #555; margin-top: 0;">The CSV is attached to this email.</p>
    <table style="border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding: 4px 12px 4px 0; color: #555;">Portfolio</td><td>${schedule.portfolioId}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #555;">File</td><td>${filename}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #555;">Generated</td><td>${new Date().toISOString()}</td></tr>
    </table>
    <p style="color: #777; font-size: 12px;">
      To change or stop these emails, update the export schedule for this portfolio in the app.
    </p>
  </body>
</html>
    `.trim()
}

export interface RebalanceHistoryExportJsonPayload {
    exportedAt: string
    portfolioId: string
    filters: { from: string | null; to: string | null }
    count: number
    meta: { format: 'json'; purpose: 'rebalance history export' }
    history: RebalanceEvent[]
}

export function buildRebalanceHistoryExportJson(
    portfolioId: string,
    filters: { from?: string; to?: string },
    history: RebalanceEvent[],
): RebalanceHistoryExportJsonPayload {
    return {
        exportedAt: new Date().toISOString(),
        portfolioId,
        filters: { from: filters.from ?? null, to: filters.to ?? null },
        count: history.length,
        meta: { format: 'json', purpose: 'rebalance history export' },
        history,
    }
}

export function buildRebalanceHistoryExportCsv(history: RebalanceEvent[]): string {
    const headers = [
        'id', 'portfolioId', 'timestamp', 'trigger', 'trades', 'gasUsed', 'status',
        'isAutomatic', 'eventSource', 'onChainTxHash', 'fromAsset', 'toAsset', 'amount',
        'feePaid', 'slippageBps', 'gasFeeXlm', 'gasFeeUsd', 'tradeLegs',
    ]
    const rows = history.map((e) => [
        e.id,
        e.portfolioId,
        e.timestamp,
        e.trigger,
        e.trades,
        e.gasUsed,
        e.status,
        e.isAutomatic ? 'true' : 'false',
        e.eventSource ?? '',
        e.onChainTxHash ?? '',
        e.details?.fromAsset ?? '',
        e.details?.toAsset ?? '',
        e.details?.amount ?? '',
        e.feePaid ?? '',
        e.slippageBps ?? '',
        e.details?.gasFeeXlm ?? '',
        e.details?.gasFeeUsd ?? '',
        e.details?.gasBreakdown ? JSON.stringify(e.details.gasBreakdown) : '',
    ])
    const head = headers.join(',')
    const body = rows.map((r) => r.map(csvEscape).join(',')).join('\n')
    return `${head}\n${body}\n`
}

export async function getRebalanceHistoryExport(
    portfolioId: string,
    format: 'json' | 'csv',
    filters: { from?: string; to?: string } = {},
): Promise<ExportResult | null> {
    const portfolio = await portfolioStorage.getPortfolio(portfolioId)
    if (!portfolio) return null

    const history = await rebalanceHistoryService.getRebalanceHistoryForExport(portfolioId, filters)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safeId = portfolioId.slice(0, 8)

    if (format === 'json') {
        const payload = buildRebalanceHistoryExportJson(portfolioId, filters, history)
        return {
            contentType: 'application/json; charset=utf-8',
            filename: `portfolio-${safeId}-rebalance-history-${timestamp}.json`,
            body: JSON.stringify(payload, null, 2),
        }
    }

    return {
        contentType: 'text/csv; charset=utf-8',
        filename: `portfolio-${safeId}-rebalance-history-${timestamp}.csv`,
        body: buildRebalanceHistoryExportCsv(history),
    }
}
