/**
 * Per-portfolio notification preference overrides (#1395).
 *
 * Covers the resolution logic (override present vs fallback to global), the
 * service layer, and the HTTP endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { NotificationPreferences, PortfolioNotificationOverride } from '../db/notificationDb.js'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logAudit: vi.fn(),
}))

// ── in-memory stand-ins for the sqlite-backed notification tables ────────────

const globalPrefs = new Map<string, NotificationPreferences>()
const overrides = new Map<string, PortfolioNotificationOverride>()

const key = (userId: string, portfolioId: string) => `${userId}::${portfolioId}`

vi.mock('../db/notificationDb.js', () => ({
    dbGetNotificationPreferences: vi.fn((userId: string) => globalPrefs.get(userId)),
    dbSaveNotificationPreferences: vi.fn((prefs: NotificationPreferences) => {
        globalPrefs.set(prefs.userId, prefs)
    }),
    dbInitDefaultNotificationPreferences: vi.fn((userId: string) => {
        const defaults: NotificationPreferences = {
            userId,
            emailEnabled: false,
            webhookEnabled: false,
            digestMode: 'immediate',
            events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
        }
        globalPrefs.set(userId, defaults)
        return defaults
    }),
    dbGetAllNotificationPreferences: vi.fn(() => [...globalPrefs.values()]),
    dbLogNotificationOutcome: vi.fn(),
    dbGetNotificationLogs: vi.fn(() => []),
    dbSaveDigestEvent: vi.fn(),
    dbGetAndDeleteDigestEventsBefore: vi.fn(() => []),
    dbGetPortfolioNotificationOverride: vi.fn((userId: string, portfolioId: string) =>
        overrides.get(key(userId, portfolioId)),
    ),
    dbSavePortfolioNotificationOverride: vi.fn((o: PortfolioNotificationOverride) => {
        const stored = { ...o, updatedAt: new Date().toISOString() }
        overrides.set(key(o.userId, o.portfolioId), stored)
        return stored
    }),
    dbListPortfolioNotificationOverrides: vi.fn((userId: string) =>
        [...overrides.values()].filter(o => o.userId === userId),
    ),
    dbDeletePortfolioNotificationOverride: vi.fn((userId: string, portfolioId: string) =>
        overrides.delete(key(userId, portfolioId)),
    ),
}))

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        getUserPreferences: vi.fn(() => ({ default_threshold: 5 })),
        upsertUserPreferences: vi.fn(),
    },
}))

vi.mock('nodemailer', () => ({
    default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}))

vi.mock('../services/webhookDeadLetter.js', () => ({
    webhookDeadLetterQueue: { push: vi.fn() },
}))

const mockGetPortfolio = vi.fn()

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: { getPortfolio: (...a: unknown[]) => mockGetPortfolio(...a) },
}))

vi.mock('../middleware/requireJwt.js', () => ({
    requireJwt: (req: any, _res: any, next: any) => {
        req.user = { address: USER }
        next()
    },
    requireJwtWhenEnabled: (req: any, _res: any, next: any) => next(),
}))

const USER = 'GUSERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const PORTFOLIO_ID = 'portfolio-abc'

function seedGlobal(overridesToApply: Partial<NotificationPreferences> = {}): NotificationPreferences {
    const prefs: NotificationPreferences = {
        userId: USER,
        emailEnabled: true,
        emailAddress: 'global@example.com',
        webhookEnabled: false,
        webhookUrl: undefined,
        digestMode: 'immediate',
        events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: false },
        ...overridesToApply,
    }
    globalPrefs.set(USER, prefs)
    return prefs
}

async function makeApp() {
    const { preferencesRouter } = await import('../api/preferences.routes.js')
    const app = express()
    app.use(express.json())
    app.use('/api', preferencesRouter)
    return app
}

describe('per-portfolio notification overrides (#1395)', () => {
    beforeEach(() => {
        globalPrefs.clear()
        overrides.clear()
        vi.clearAllMocks()
        mockGetPortfolio.mockResolvedValue({ id: PORTFOLIO_ID, userAddress: USER })
    })

    describe('resolution', () => {
        it('falls back to global preferences when no override exists', async () => {
            const { resolvePortfolioNotificationPreferences } = await import('../services/notificationPreferences.js')
            const global = seedGlobal()

            const resolved = resolvePortfolioNotificationPreferences(global, undefined)

            expect(resolved.overrideApplied).toBe(false)
            expect(resolved.emailEnabled).toBe(true)
            expect(resolved.emailAddress).toBe('global@example.com')
            expect(resolved.events).toEqual(global.events)
        })

        it('layers override fields on top of global settings', async () => {
            const { resolvePortfolioNotificationPreferences } = await import('../services/notificationPreferences.js')
            const global = seedGlobal()

            const resolved = resolvePortfolioNotificationPreferences(global, {
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                emailAddress: 'portfolio@example.com',
                digestMode: 'weekly',
            })

            expect(resolved.overrideApplied).toBe(true)
            expect(resolved.emailAddress).toBe('portfolio@example.com')
            expect(resolved.digestMode).toBe('weekly')
            // Untouched fields still come from global.
            expect(resolved.emailEnabled).toBe(true)
            expect(resolved.events.rebalance).toBe(true)
        })

        it('merges event flags key-by-key rather than replacing the whole set', async () => {
            const { resolvePortfolioNotificationPreferences } = await import('../services/notificationPreferences.js')
            const global = seedGlobal()

            const resolved = resolvePortfolioNotificationPreferences(global, {
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                events: { rebalance: false },
            })

            expect(resolved.events).toEqual({
                rebalance: false,        // overridden
                circuitBreaker: true,    // from global
                priceMovement: true,     // from global
                riskChange: false,       // from global
            })
        })

        it('can disable a channel for one portfolio only', async () => {
            const { resolvePortfolioNotificationPreferences } = await import('../services/notificationPreferences.js')
            const global = seedGlobal()

            const resolved = resolvePortfolioNotificationPreferences(global, {
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                emailEnabled: false,
            })

            expect(resolved.emailEnabled).toBe(false)
            expect(global.emailEnabled).toBe(true)
        })

        it('keeps a channel off when the override enables it with no destination anywhere', async () => {
            const { resolvePortfolioNotificationPreferences } = await import('../services/notificationPreferences.js')
            const global = seedGlobal({ webhookEnabled: false, webhookUrl: undefined })

            const resolved = resolvePortfolioNotificationPreferences(global, {
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                webhookEnabled: true,
            })

            // Half-configured overrides must not silently swallow notifications.
            expect(resolved.webhookEnabled).toBe(false)
        })

        it('enables a channel when the override supplies the destination', async () => {
            const { resolvePortfolioNotificationPreferences } = await import('../services/notificationPreferences.js')
            const global = seedGlobal({ webhookEnabled: false })

            const resolved = resolvePortfolioNotificationPreferences(global, {
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                webhookEnabled: true,
                webhookUrl: 'https://hooks.example.com/abc',
            })

            expect(resolved.webhookEnabled).toBe(true)
            expect(resolved.webhookUrl).toBe('https://hooks.example.com/abc')
        })
    })

    describe('service layer', () => {
        it('resolves global preferences when no portfolioId is supplied', async () => {
            const { notificationService } = await import('../services/notificationService.js')
            seedGlobal()

            const resolved = notificationService.getPreferencesForPortfolio(USER)

            expect(resolved.overrideApplied).toBe(false)
            expect(resolved.emailAddress).toBe('global@example.com')
        })

        it('applies a stored override for the portfolio', async () => {
            const { notificationService } = await import('../services/notificationService.js')
            seedGlobal()

            notificationService.setPortfolioOverride({
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                emailAddress: 'portfolio@example.com',
            })

            const resolved = notificationService.getPreferencesForPortfolio(USER, PORTFOLIO_ID)
            expect(resolved.overrideApplied).toBe(true)
            expect(resolved.emailAddress).toBe('portfolio@example.com')
        })

        it('leaves other portfolios on global settings', async () => {
            const { notificationService } = await import('../services/notificationService.js')
            seedGlobal()

            notificationService.setPortfolioOverride({
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                emailEnabled: false,
            })

            const other = notificationService.getPreferencesForPortfolio(USER, 'portfolio-other')
            expect(other.overrideApplied).toBe(false)
            expect(other.emailEnabled).toBe(true)
        })

        it('falls back to global again once the override is deleted', async () => {
            const { notificationService } = await import('../services/notificationService.js')
            seedGlobal()

            notificationService.setPortfolioOverride({
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                emailEnabled: false,
            })
            expect(notificationService.getPreferencesForPortfolio(USER, PORTFOLIO_ID).emailEnabled).toBe(false)

            expect(notificationService.deletePortfolioOverride(USER, PORTFOLIO_ID)).toBe(true)

            const resolved = notificationService.getPreferencesForPortfolio(USER, PORTFOLIO_ID)
            expect(resolved.overrideApplied).toBe(false)
            expect(resolved.emailEnabled).toBe(true)
        })

        it('propagates a later global change to portfolios that did not override that field', async () => {
            const { notificationService } = await import('../services/notificationService.js')
            seedGlobal()

            notificationService.setPortfolioOverride({
                userId: USER,
                portfolioId: PORTFOLIO_ID,
                digestMode: 'weekly',
            })

            // Change a *different* global field afterwards.
            seedGlobal({ emailAddress: 'changed@example.com' })

            const resolved = notificationService.getPreferencesForPortfolio(USER, PORTFOLIO_ID)
            expect(resolved.emailAddress).toBe('changed@example.com')
            expect(resolved.digestMode).toBe('weekly')
        })

        it('lists the overrides belonging to a user', async () => {
            const { notificationService } = await import('../services/notificationService.js')
            seedGlobal()

            notificationService.setPortfolioOverride({ userId: USER, portfolioId: 'p1', emailEnabled: false })
            notificationService.setPortfolioOverride({ userId: USER, portfolioId: 'p2', digestMode: 'daily' })
            notificationService.setPortfolioOverride({ userId: 'GOTHER', portfolioId: 'p3', emailEnabled: false })

            expect(notificationService.listPortfolioOverrides(USER).map(o => o.portfolioId)).toEqual(['p1', 'p2'])
        })
    })

    describe('HTTP endpoints', () => {
        it('PUT stores an override and returns the resolved preferences', async () => {
            const app = await makeApp()
            seedGlobal()

            const res = await request(app)
                .put(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)
                .send({ digestMode: 'weekly', events: { rebalance: false } })

            expect(res.status).toBe(200)
            expect(res.body.data.override).toMatchObject({ portfolioId: PORTFOLIO_ID, digestMode: 'weekly' })
            expect(res.body.data.resolved).toMatchObject({ overrideApplied: true, digestMode: 'weekly' })
            expect(res.body.data.resolved.events.circuitBreaker).toBe(true)
        })

        it('GET reports fallback when no override is configured', async () => {
            const app = await makeApp()
            seedGlobal()

            const res = await request(app).get(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)

            expect(res.status).toBe(200)
            expect(res.body.data.override).toBeNull()
            expect(res.body.data.resolved.overrideApplied).toBe(false)
        })

        it('GET returns the stored override once set', async () => {
            const app = await makeApp()
            seedGlobal()
            await request(app)
                .put(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)
                .send({ emailEnabled: false })

            const res = await request(app).get(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)

            expect(res.body.data.override).toMatchObject({ emailEnabled: false })
            expect(res.body.data.resolved.emailEnabled).toBe(false)
        })

        it('DELETE removes the override and resolves back to global', async () => {
            const app = await makeApp()
            seedGlobal()
            await request(app)
                .put(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)
                .send({ emailEnabled: false })

            const res = await request(app).delete(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)

            expect(res.status).toBe(200)
            expect(res.body.data.deleted).toBe(true)
            expect(res.body.data.resolved.emailEnabled).toBe(true)
        })

        it('DELETE returns 404 when nothing is configured', async () => {
            const app = await makeApp()
            seedGlobal()

            const res = await request(app).delete(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)

            expect(res.status).toBe(404)
        })

        it('rejects enabling email with no address in either layer', async () => {
            const app = await makeApp()
            seedGlobal({ emailEnabled: false, emailAddress: undefined })

            const res = await request(app)
                .put(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)
                .send({ emailEnabled: true })

            expect(res.status).toBe(422)
            expect(res.body.error.message).toContain('emailAddress')
        })

        it('returns 404 for an unknown portfolio', async () => {
            const app = await makeApp()
            mockGetPortfolio.mockResolvedValue(null)

            const res = await request(app)
                .put('/api/preferences/notifications/portfolio/ghost')
                .send({ emailEnabled: false })

            expect(res.status).toBe(404)
        })

        it('returns 403 for a portfolio owned by someone else', async () => {
            const app = await makeApp()
            mockGetPortfolio.mockResolvedValue({ id: PORTFOLIO_ID, userAddress: 'GSOMEONEELSE' })

            const res = await request(app)
                .put(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)
                .send({ emailEnabled: false })

            expect(res.status).toBe(403)
        })

        it('rejects an unknown field', async () => {
            const app = await makeApp()
            seedGlobal()

            const res = await request(app)
                .put(`/api/preferences/notifications/portfolio/${PORTFOLIO_ID}`)
                .send({ smsEnabled: true })

            expect(res.status).toBe(422)
        })

        it('lists all overrides for the caller', async () => {
            const app = await makeApp()
            seedGlobal()
            await request(app).put('/api/preferences/notifications/portfolio/p1').send({ emailEnabled: false })
            await request(app).put('/api/preferences/notifications/portfolio/p2').send({ digestMode: 'daily' })

            const res = await request(app).get('/api/preferences/notifications/portfolio')

            expect(res.status).toBe(200)
            expect(res.body.data.count).toBe(2)
        })
    })
})
