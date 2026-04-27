import express from 'express'
import cors from 'cors'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildCorsOptions, enforceCorsOriginAllowlist } from '../http/corsSecurity.js'

function createCorsApp(corsOrigins: string[]) {
    const app = express()
    const corsOptions = buildCorsOptions(corsOrigins)
    app.use(enforceCorsOriginAllowlist(corsOrigins))
    app.use(cors(corsOptions))
    app.options('*', cors(corsOptions))
    app.get('/secure', (_req, res) => {
        res.status(200).json({ ok: true })
    })
    return app
}

describe('CORS security policy', () => {
    it('allows configured origin requests with credentials', async () => {
        const app = createCorsApp(['https://app.example.com'])
        const res = await request(app)
            .get('/secure')
            .set('Origin', 'https://app.example.com')
            .expect(200)

        expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com')
        expect(res.headers['access-control-allow-credentials']).toBe('true')
    })

    it('rejects unlisted origins with 403', async () => {
        const app = createCorsApp(['https://app.example.com'])
        const res = await request(app)
            .get('/secure')
            .set('Origin', 'https://evil.example.com')
            .expect(403)

        expect(res.body.error?.code).toBe('CORS_FORBIDDEN_ORIGIN')
    })

    it('blocks preflight OPTIONS from unlisted origins', async () => {
        const app = createCorsApp(['https://app.example.com'])
        const res = await request(app)
            .options('/secure')
            .set('Origin', 'https://evil.example.com')
            .set('Access-Control-Request-Method', 'POST')
            .expect(403)

        expect(res.body.error?.code).toBe('CORS_FORBIDDEN_ORIGIN')
    })

    it('never emits wildcard origin when credentials are enabled', async () => {
        const app = createCorsApp(['https://app.example.com'])
        const res = await request(app)
            .get('/secure')
            .set('Origin', 'https://app.example.com')
            .expect(200)

        expect(res.headers['access-control-allow-credentials']).toBe('true')
        expect(res.headers['access-control-allow-origin']).not.toBe('*')
    })
})
