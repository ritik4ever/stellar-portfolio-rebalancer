/**
 * Scheduled recurring portfolio export (#1411).
 *
 * Verifies that a due schedule generates a CSV through the *existing* export
 * pipeline and dispatches it as an email attachment, that run outcomes are
 * recorded and the cursor advances, and that the queue worker drives the sweep.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ExportSchedule } from '../db/exportScheduleDb.js'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Keep the worker import off BullMQ/Redis — only the job processor is exercised.
vi.mock('bullmq', () => ({
    Worker: class { on() { return this } async close() {} },
    Queue: class { on() { return this } async add() {} async close() {} },
    Job: class {},
}))

vi.mock('../queue/connection.js', () => ({
    getConnectionOptions: () => ({}),
    REDIS_URL: 'redis://localhost:6379',
    getRedisUrl: () => 'redis://localhost:6379',
    isRedisAvailable: async () => false,
    probeRedis: async () => false,
    getCachedRedisAvailability: () => false,
    refreshRedisCredentials: async () => undefined,
}))

// ── in-memory schedule store (the real one is sqlite-backed) ─────────────────

const schedules = new Map<string, ExportSchedule>()
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const recordRunSpy = vi.fn()

vi.mock('../db/exportScheduleDb.js', () => ({
    WEEK_MS: 7 * 24 * 60 * 60 * 1000,
    dbUpsertExportSchedule: vi.fn((input: any) => {
        const now = new Date().toISOString()
        const existing = schedules.get(input.portfolioId)
        const schedule: ExportSchedule = {
            portfolioId: input.portfolioId,
            userAddress: input.userAddress,
            frequency: input.frequency ?? 'weekly',
            format: input.format ?? 'csv',
            emailAddress: input.emailAddress,
            enabled: input.enabled === false ? false : true,
            nextRunAt: input.nextRunAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            lastRunAt: existing?.lastRunAt,
            lastStatus: existing?.lastStatus,
            lastError: existing?.lastError,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        }
        schedules.set(schedule.portfolioId, schedule)
        return schedule
    }),
    dbGetExportSchedule: vi.fn((id: string) => schedules.get(id)),
    dbListExportSchedulesForUser: vi.fn((user: string) =>
        [...schedules.values()].filter(s => s.userAddress === user),
    ),
    dbListDueExportSchedules: vi.fn((asOf: string = new Date().toISOString()) =>
        [...schedules.values()].filter(s => s.enabled && s.nextRunAt <= asOf),
    ),
    dbRecordExportScheduleRun: vi.fn((id: string, outcome: any) => {
        recordRunSpy(id, outcome)
        const schedule = schedules.get(id)
        if (!schedule) return
        schedule.lastRunAt = new Date().toISOString()
        schedule.lastStatus = outcome.status
        schedule.lastError = outcome.error
        schedule.nextRunAt = outcome.nextRunAt ?? schedule.nextRunAt
    }),
    dbDeleteExportSchedule: vi.fn((id: string) => schedules.delete(id)),
}))

// ── export generation dependencies ───────────────────────────────────────────

const mockGetPortfolio = vi.fn()
const mockGetRebalanceHistory = vi.fn()

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: { getPortfolio: (...args: unknown[]) => mockGetPortfolio(...args) },
}))

vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: {
        getRebalanceHistory: (...args: unknown[]) => mockGetRebalanceHistory(...args),
        getRebalanceHistoryForExport: vi.fn(async () => []),
    },
    riskManagementService: {},
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        async getCurrentPrices() { return {} }
    },
}))

const mockSendEmailWithAttachment = vi.fn()

vi.mock('../services/notificationService.js', () => ({
    notificationService: {
        sendEmailWithAttachment: (...args: unknown[]) => mockSendEmailWithAttachment(...args),
    },
}))

const PORTFOLIO_ID = 'portfolio-123'
const USER = 'GUSERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const EMAIL = 'user@example.com'

function seedSchedule(overrides: Partial<ExportSchedule> = {}): ExportSchedule {
    const now = new Date().toISOString()
    const schedule: ExportSchedule = {
        portfolioId: PORTFOLIO_ID,
        userAddress: USER,
        frequency: 'weekly',
        format: 'csv',
        emailAddress: EMAIL,
        enabled: true,
        nextRunAt: new Date(Date.now() - 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
        ...overrides,
    }
    schedules.set(schedule.portfolioId, schedule)
    return schedule
}

function seedPortfolioWithHistory() {
    mockGetPortfolio.mockResolvedValue({
        id: PORTFOLIO_ID,
        userAddress: USER,
        allocations: { XLM: 60, USDC: 40 },
        threshold: 5,
        createdAt: '2026-01-01T00:00:00Z',
        lastRebalance: '2026-02-01T00:00:00Z',
    })
    mockGetRebalanceHistory.mockResolvedValue([
        {
            id: 'evt-1',
            portfolioId: PORTFOLIO_ID,
            timestamp: '2026-02-01T00:00:00Z',
            trigger: 'threshold',
            trades: 1,
            gasUsed: '0.001',
            status: 'completed',
            isAutomatic: true,
            details: { fromAsset: 'XLM', toAsset: 'USDC', amount: 100 },
        },
    ])
}

describe('scheduled portfolio export (#1411)', () => {
    beforeEach(() => {
        schedules.clear()
        vi.clearAllMocks()
        mockSendEmailWithAttachment.mockResolvedValue(undefined)
        seedPortfolioWithHistory()
    })

    describe('schedule configuration', () => {
        it('opts a portfolio into a weekly CSV export', async () => {
            const { setExportSchedule } = await import('../services/portfolioExportService.js')

            const schedule = setExportSchedule({
                portfolioId: PORTFOLIO_ID,
                userAddress: USER,
                emailAddress: EMAIL,
            })

            expect(schedule).toMatchObject({
                portfolioId: PORTFOLIO_ID,
                frequency: 'weekly',
                format: 'csv',
                emailAddress: EMAIL,
                enabled: true,
            })
        })

        it('defaults the first run to one week out', async () => {
            const { setExportSchedule } = await import('../services/portfolioExportService.js')

            const schedule = setExportSchedule({
                portfolioId: PORTFOLIO_ID,
                userAddress: USER,
                emailAddress: EMAIL,
            })

            const delta = new Date(schedule.nextRunAt).getTime() - Date.now()
            expect(delta).toBeGreaterThan(WEEK_MS - 60_000)
            expect(delta).toBeLessThanOrEqual(WEEK_MS + 1000)
        })

        it('supports opting out and reading back the schedule', async () => {
            const { setExportSchedule, getExportSchedule, deleteExportSchedule } =
                await import('../services/portfolioExportService.js')

            setExportSchedule({ portfolioId: PORTFOLIO_ID, userAddress: USER, emailAddress: EMAIL, enabled: false })
            expect(getExportSchedule(PORTFOLIO_ID)?.enabled).toBe(false)

            expect(deleteExportSchedule(PORTFOLIO_ID)).toBe(true)
            expect(getExportSchedule(PORTFOLIO_ID)).toBeUndefined()
        })

        it('lists a user\'s schedules', async () => {
            const { setExportSchedule, listExportSchedulesForUser } =
                await import('../services/portfolioExportService.js')

            setExportSchedule({ portfolioId: 'p1', userAddress: USER, emailAddress: EMAIL })
            setExportSchedule({ portfolioId: 'p2', userAddress: USER, emailAddress: EMAIL })
            setExportSchedule({ portfolioId: 'p3', userAddress: 'GOTHER', emailAddress: EMAIL })

            expect(listExportSchedulesForUser(USER).map(s => s.portfolioId)).toEqual(['p1', 'p2'])
        })
    })

    describe('running a scheduled export', () => {
        it('emails a CSV attachment built by the existing export pipeline', async () => {
            const { runScheduledExport, buildExportCsv } = await import('../services/portfolioExportService.js')
            const schedule = seedSchedule()

            const result = await runScheduledExport(schedule)

            expect(result).toMatchObject({ status: 'sent', emailedTo: EMAIL })
            expect(mockSendEmailWithAttachment).toHaveBeenCalledOnce()

            const mail = mockSendEmailWithAttachment.mock.calls[0][0]
            expect(mail.to).toBe(EMAIL)
            expect(mail.subject).toContain('weekly portfolio export')
            expect(mail.attachments).toHaveLength(1)
            expect(mail.attachments[0].filename).toMatch(/\.csv$/)
            expect(mail.attachments[0].contentType).toContain('text/csv')

            // The attachment is byte-for-byte what buildExportCsv produces —
            // proving generation is reused rather than reimplemented.
            const history = await mockGetRebalanceHistory.mock.results[0].value
            expect(mail.attachments[0].content).toBe(buildExportCsv(history))
        })

        it('generates the export through getPortfolioExport with the csv format', async () => {
            const { runScheduledExport } = await import('../services/portfolioExportService.js')

            await runScheduledExport(seedSchedule())

            expect(mockGetPortfolio).toHaveBeenCalledWith(PORTFOLIO_ID)
            expect(mockGetRebalanceHistory).toHaveBeenCalledWith(PORTFOLIO_ID, expect.any(Number))
        })

        it('records success and advances the cursor one week', async () => {
            const { runScheduledExport } = await import('../services/portfolioExportService.js')

            await runScheduledExport(seedSchedule())

            expect(recordRunSpy).toHaveBeenCalledWith(
                PORTFOLIO_ID,
                expect.objectContaining({ status: 'success' }),
            )
            const nextRun = new Date(schedules.get(PORTFOLIO_ID)!.nextRunAt).getTime()
            expect(nextRun - Date.now()).toBeGreaterThan(WEEK_MS - 60_000)
        })

        it('records a failure when email dispatch fails, and still moves on', async () => {
            mockSendEmailWithAttachment.mockRejectedValue(new Error('SMTP unavailable'))
            const { runScheduledExport } = await import('../services/portfolioExportService.js')

            const result = await runScheduledExport(seedSchedule())

            expect(result).toMatchObject({ status: 'failed', reason: 'SMTP unavailable' })
            expect(recordRunSpy).toHaveBeenCalledWith(
                PORTFOLIO_ID,
                expect.objectContaining({ status: 'failed', error: 'SMTP unavailable' }),
            )
            // Cursor still advanced — a bad run must not wedge the schedule.
            expect(new Date(schedules.get(PORTFOLIO_ID)!.nextRunAt).getTime()).toBeGreaterThan(Date.now())
        })

        it('disables the schedule when the portfolio no longer exists', async () => {
            mockGetPortfolio.mockResolvedValue(null)
            const { runScheduledExport } = await import('../services/portfolioExportService.js')

            const result = await runScheduledExport(seedSchedule())

            expect(result).toMatchObject({ status: 'skipped', reason: 'portfolio_not_found' })
            expect(schedules.get(PORTFOLIO_ID)!.enabled).toBe(false)
            expect(mockSendEmailWithAttachment).not.toHaveBeenCalled()
        })
    })

    describe('the due sweep', () => {
        it('runs only schedules that are due and enabled', async () => {
            const { runDueExportSchedules } = await import('../services/portfolioExportService.js')

            seedSchedule({ portfolioId: 'due-1' })
            seedSchedule({ portfolioId: 'due-2' })
            seedSchedule({ portfolioId: 'not-yet', nextRunAt: new Date(Date.now() + WEEK_MS).toISOString() })
            seedSchedule({ portfolioId: 'disabled', enabled: false })

            const results = await runDueExportSchedules()

            expect(results.map(r => r.portfolioId).sort()).toEqual(['due-1', 'due-2'])
            expect(mockSendEmailWithAttachment).toHaveBeenCalledTimes(2)
        })

        it('does nothing when no schedule is due', async () => {
            const { runDueExportSchedules } = await import('../services/portfolioExportService.js')
            seedSchedule({ nextRunAt: new Date(Date.now() + WEEK_MS).toISOString() })

            expect(await runDueExportSchedules()).toEqual([])
            expect(mockSendEmailWithAttachment).not.toHaveBeenCalled()
        })

        it('keeps going after one schedule fails', async () => {
            const { runDueExportSchedules } = await import('../services/portfolioExportService.js')
            mockSendEmailWithAttachment
                .mockRejectedValueOnce(new Error('SMTP unavailable'))
                .mockResolvedValue(undefined)

            seedSchedule({ portfolioId: 'first' })
            seedSchedule({ portfolioId: 'second' })

            const results = await runDueExportSchedules()

            expect(results).toHaveLength(2)
            expect(results.filter(r => r.status === 'failed')).toHaveLength(1)
            expect(results.filter(r => r.status === 'sent')).toHaveLength(1)
        })
    })

    describe('queue worker', () => {
        it('summarises the sweep for the job result', async () => {
            const { processScheduledExportJob } = await import('../queue/workers/scheduledExportWorker.js')
            mockSendEmailWithAttachment
                .mockRejectedValueOnce(new Error('SMTP unavailable'))
                .mockResolvedValue(undefined)

            seedSchedule({ portfolioId: 'a' })
            seedSchedule({ portfolioId: 'b' })
            seedSchedule({ portfolioId: 'c', nextRunAt: new Date(Date.now() + WEEK_MS).toISOString() })

            const summary = await processScheduledExportJob({
                id: 'job-1',
                data: { triggeredBy: 'scheduler' },
            } as any)

            expect(summary).toEqual({ processed: 2, sent: 1, failed: 1, skipped: 0 })
        })

        it('honours an explicit asOf cutoff', async () => {
            const { processScheduledExportJob } = await import('../queue/workers/scheduledExportWorker.js')

            const past = new Date(Date.now() - 2000).toISOString()
            seedSchedule({ portfolioId: 'old', nextRunAt: past })
            seedSchedule({ portfolioId: 'new', nextRunAt: new Date(Date.now() + 5000).toISOString() })

            const summary = await processScheduledExportJob({
                id: 'job-2',
                data: { triggeredBy: 'manual', asOf: new Date(Date.now() - 1000).toISOString() },
            } as any)

            expect(summary.processed).toBe(1)
            expect(summary.sent).toBe(1)
        })
    })
})
