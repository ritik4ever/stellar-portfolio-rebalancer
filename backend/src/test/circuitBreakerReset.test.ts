import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { opsRouter } from '../api/ops.routes.js';
import { riskManagementService } from '../services/serviceContainer.js';

function makeAdminHeaders(kp: Keypair) {
    const msg = Date.now().toString();
    const sig = kp.sign(Buffer.from(msg, 'utf8')).toString('base64');
    return {
        'x-public-key': kp.publicKey(),
        'x-message': msg,
        'x-signature': sig,
    };
}

describe('Admin Circuit Breaker Reset Endpoint', () => {
    let app: Express;
    let adminKp: Keypair;
    let nonAdminKp: Keypair;

    beforeAll(() => {
        adminKp = Keypair.random();
        nonAdminKp = Keypair.random();
        vi.stubEnv('ADMIN_PUBLIC_KEYS', adminKp.publicKey());

        app = express();
        app.use(express.json());
        app.use('/api/ops', opsRouter);
    });

    afterAll(() => {
        vi.unstubAllEnvs();
    });

    beforeEach(() => {
        // Manually trigger a circuit breaker state in riskManagementService
        (riskManagementService as any).circuitBreakers.set('TEST_PORTFOLIO', {
            isTriggered: true,
            triggerReason: 'High Volatility',
            cooldownUntil: Date.now() + 600000,
            triggeredAssets: ['XLM']
        });
    });

    it('returns 401 when called without admin authentication headers', async () => {
        const res = await request(app)
            .post('/api/ops/circuit-breaker/TEST_PORTFOLIO/reset');
        expect(res.status).toBe(401);
    });

    it('returns 403 when called with non-admin key headers', async () => {
        const res = await request(app)
            .post('/api/ops/circuit-breaker/TEST_PORTFOLIO/reset')
            .set(makeAdminHeaders(nonAdminKp));
        expect(res.status).toBe(403);
    });

    it('resets the circuit breaker and returns 200 when called by an admin', async () => {
        // Verify circuit breaker is currently triggered
        const statusBefore = riskManagementService.getCircuitBreakerStatus();
        expect(statusBefore['TEST_PORTFOLIO']?.isTriggered).toBe(true);

        const res = await request(app)
            .post('/api/ops/circuit-breaker/TEST_PORTFOLIO/reset')
            .set(makeAdminHeaders(adminKp));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.portfolioId).toBe('TEST_PORTFOLIO');
        expect(res.body.data.reset).toBe(true);
        expect(res.body.data.actor).toBe(adminKp.publicKey());

        // Verify circuit breaker state in riskManagementService is reset
        const statusAfter = riskManagementService.getCircuitBreakerStatus();
        expect(statusAfter['TEST_PORTFOLIO']?.isTriggered).toBe(false);
    });
});
