/**
 * Scoped API key tests.
 *
 * Covers the read-only vs read-write scope end to end: creation stores the scope,
 * the authentication middleware rejects read-only keys on mutating endpoints while
 * still accepting them on GET endpoints, and the management response exposes the scope.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
    createApiKey,
    generateApiKeyId,
    generateApiKeyString,
    listApiKeysForUser,
    revokeApiKey,
    rotateApiKey,
    type ApiKeyScope,
} from '../db/apiKeyDb.js'
import { requireApiKey, requireReadWrite, isMutatingMethod } from '../middleware/requireApiKey.js'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const USER = 'GTESTUSERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function makeApp() {
    const app = express()
    app.use(express.json())

    // Representative read endpoints
    app.get('/api/portfolios', requireApiKey, (req, res) => {
        res.status(200).json({ ok: true, scope: req.apiKeyUser?.scope })
    })
    app.get('/api/portfolios/:id', requireApiKey, (req, res) => {
        res.status(200).json({ ok: true, id: req.params.id })
    })

    // Representative write endpoints
    app.post('/api/portfolios', requireApiKey, (req, res) => {
        res.status(201).json({ created: true })
    })
    app.put('/api/portfolios/:id', requireApiKey, (req, res) => {
        res.status(200).json({ updated: true })
    })
    app.patch('/api/portfolios/:id', requireApiKey, (req, res) => {
        res.status(200).json({ patched: true })
    })
    app.delete('/api/portfolios/:id', requireApiKey, (req, res) => {
        res.status(200).json({ deleted: true })
    })

    // Read verb that is logically a write — guarded explicitly
    app.get('/api/portfolios/:id/rebalance', requireApiKey, requireReadWrite, (req, res) => {
        res.status(200).json({ rebalanced: true })
    })

    return app
}

async function mintKey(scope: ApiKeyScope, name = `${scope}-key`): Promise<string> {
    const rawKey = generateApiKeyString()
    await createApiKey(generateApiKeyId(), USER, name, rawKey, scope)
    return rawKey
}

describe('scoped API keys', () => {
    let app: express.Express

    beforeEach(() => {
        app = makeApp()
    })

    describe('creation', () => {
        it('persists the requested scope', async () => {
            await mintKey('read-only', 'ro')
            await mintKey('read-write', 'rw')

            const keys = await listApiKeysForUser(USER)
            const scopes = keys.filter(k => ['ro', 'rw'].includes(k.name)).map(k => k.scope).sort()

            expect(scopes).toEqual(['read-only', 'read-write'])
        })

        it('exposes the scope on the management listing (never the hash)', async () => {
            await mintKey('read-only', 'listing-check')

            const keys = await listApiKeysForUser(USER)
            const key = keys.find(k => k.name === 'listing-check')!

            expect(key.scope).toBe('read-only')
            expect(key).not.toHaveProperty('key_hash')
        })

        it('carries the scope across a rotation', async () => {
            const rawKey = generateApiKeyString()
            const oldId = generateApiKeyId()
            await createApiKey(oldId, USER, 'rotate-me', rawKey, 'read-only')

            const result = await rotateApiKey(oldId, USER, generateApiKeyId(), generateApiKeyString())

            expect(result).toMatchObject({ name: 'rotate-me', scope: 'read-only' })
        })
    })

    describe('read-only keys', () => {
        it('are accepted on GET endpoints', async () => {
            const key = await mintKey('read-only')

            const res = await request(app).get('/api/portfolios').set('X-API-Key', key)

            expect(res.status).toBe(200)
            expect(res.body.scope).toBe('read-only')
        })

        it.each([
            ['post', '/api/portfolios'],
            ['put', '/api/portfolios/abc'],
            ['patch', '/api/portfolios/abc'],
            ['delete', '/api/portfolios/abc'],
        ] as const)('are rejected with 403 on %s %s', async (method, path) => {
            const key = await mintKey('read-only')

            const res = await (request(app) as any)[method](path).set('X-API-Key', key)

            expect(res.status).toBe(403)
            expect(res.body.success).toBe(false)
            expect(res.body.error.message).toMatch(/read-only/i)
        })

        it('are rejected by requireReadWrite on a mutating GET route', async () => {
            const key = await mintKey('read-only')

            const res = await request(app)
                .get('/api/portfolios/abc/rebalance')
                .set('X-API-Key', key)

            expect(res.status).toBe(403)
        })
    })

    describe('read-write keys', () => {
        it('are accepted on GET endpoints', async () => {
            const key = await mintKey('read-write')

            const res = await request(app).get('/api/portfolios').set('X-API-Key', key)

            expect(res.status).toBe(200)
            expect(res.body.scope).toBe('read-write')
        })

        it.each([
            ['post', '/api/portfolios', 201],
            ['put', '/api/portfolios/abc', 200],
            ['patch', '/api/portfolios/abc', 200],
            ['delete', '/api/portfolios/abc', 200],
        ] as const)('are accepted on %s %s', async (method, path, expected) => {
            const key = await mintKey('read-write')

            const res = await (request(app) as any)[method](path).set('X-API-Key', key)

            expect(res.status).toBe(expected)
        })

        it('pass requireReadWrite on a mutating GET route', async () => {
            const key = await mintKey('read-write')

            const res = await request(app)
                .get('/api/portfolios/abc/rebalance')
                .set('X-API-Key', key)

            expect(res.status).toBe(200)
        })
    })

    describe('authentication failures', () => {
        it('rejects a missing X-API-Key header', async () => {
            const res = await request(app).get('/api/portfolios')

            expect(res.status).toBe(401)
        })

        it('rejects an unknown key', async () => {
            const res = await request(app)
                .get('/api/portfolios')
                .set('X-API-Key', 'spr_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')

            expect(res.status).toBe(401)
        })

        it('rejects a revoked key that is outside any grace window', async () => {
            const rawKey = generateApiKeyString()
            const id = generateApiKeyId()
            await createApiKey(id, USER, 'revoked', rawKey, 'read-write')
            await revokeApiKey(id, USER)

            const res = await request(app).get('/api/portfolios').set('X-API-Key', rawKey)

            expect(res.status).toBe(401)
        })
    })

    describe('isMutatingMethod', () => {
        it('classifies write verbs as mutating', () => {
            expect(['POST', 'PUT', 'PATCH', 'DELETE'].every(isMutatingMethod)).toBe(true)
        })

        it('classifies read verbs as non-mutating', () => {
            expect(['GET', 'HEAD', 'OPTIONS'].some(isMutatingMethod)).toBe(false)
        })

        it('is case-insensitive', () => {
            expect(isMutatingMethod('post')).toBe(true)
        })
    })
})
