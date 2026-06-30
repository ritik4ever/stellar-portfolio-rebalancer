import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { portfolioRouter } from '../api/routes.js';
import { apiErrorHandler } from '../middleware/apiErrorHandler.js';
import { databaseService } from '../services/databaseService.js';
import { mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';

describe('Preferences API', () => {
    let app: express.Express;
    const testAddress = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    const dbPath = './data-test-prefs/portfolio.db';

    beforeEach(() => {
        process.env.DB_PATH = dbPath;
        mkdirSync(dirname(dbPath), { recursive: true });

        app = express();
        app.use(express.json());
        app.use('/api', portfolioRouter);
        app.use(apiErrorHandler);
    });

    afterEach(() => {
        // Clear all data to ensure tests are isolated
        databaseService.clearAll();
        rmSync('./data-test-prefs', { recursive: true, force: true });
    });

    it('GET /api/preferences should return default values for unknown user', async () => {
        const unknownAddress = 'GUNKNOWN' + Math.random().toString(36).slice(2);
        const response = await request(app)
            .get(`/api/preferences?userAddress=${unknownAddress}`)
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.preferences).toEqual({
            userAddress: unknownAddress,
            default_threshold: 5,
            default_cooldown: 3600,
            preferred_currency: 'USD',
            timezone: 'UTC',
            notification_digest_frequency: 'immediate'
        });
    });

    it('PUT /api/preferences should store and return updated values', async () => {
        const updates = {
            default_threshold: 10,
            default_cooldown: 7200,
            preferred_currency: 'EUR',
            timezone: 'Europe/Berlin',
            notification_digest_frequency: 'daily'
        };

        const putResponse = await request(app)
            .put(`/api/preferences?userAddress=${testAddress}`)
            .send(updates)
            .expect(200);

        expect(putResponse.body.success).toBe(true);
        expect(putResponse.body.data.preferences).toMatchObject(updates);

        const getResponse = await request(app)
            .get(`/api/preferences?userAddress=${testAddress}`)
            .expect(200);

        expect(getResponse.body.data.preferences).toMatchObject(updates);
    });

    it('PUT /api/preferences should support partial updates', async () => {
        const initial = {
            default_threshold: 10,
        };

        await request(app)
            .put(`/api/preferences?userAddress=${testAddress}`)
            .send(initial)
            .expect(200);

        const partialUpdate = {
            preferred_currency: 'GBP',
        };

        const response = await request(app)
            .put(`/api/preferences?userAddress=${testAddress}`)
            .send(partialUpdate)
            .expect(200);

        expect(response.body.data.preferences.default_threshold).toBe(10);
        expect(response.body.data.preferences.preferred_currency).toBe('GBP');
    });

    it('GET /api/preferences should return 422 if userAddress is missing', async () => {
        await request(app)
            .get('/api/preferences')
            .expect(422);
    });

    it('PUT /api/preferences should return 422 if body is invalid', async () => {
        await request(app)
            .put(`/api/preferences?userAddress=${testAddress}`)
            .send({ default_threshold: 100 }) // Max is 50
            .expect(422);
    });
});
