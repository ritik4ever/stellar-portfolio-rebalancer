import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { opsRouter } from '../api/ops.routes.js';
import { rebalanceLockService } from '../services/rebalanceLock.js';

function makeAdminHeaders(kp: Keypair) {
    const msg = Date.now().toString();
    const sig = kp.sign(Buffer.from(msg, 'utf8')).toString('base64');
    return {
        'x-public-key': kp.publicKey(),
        'x-message': msg,
        'x-signature': sig,
    };
}

describe('Admin Forced Rebalance Lock Release Endpoint', () => {
    let app: Express;
    let adminKp: Keypair;
    let nonAdminKp: Keypair;
    const portfolioId = 'portfolio-stale-test-123';

    beforeAll(async () => {
        adminKp = Keypair.random();
        nonAdminKp = Keypair.random();
        vi.stubEnv('ADMIN_PUBLIC_KEYS', adminKp.publicKey());

        app = express();
        app.use(express.json());
        app.use('/api/ops', opsRouter);

        await rebalanceLockService.init();
    });

    afterAll(async () => {
        vi.unstubAllEnvs();
        await rebalanceLockService.releaseLock(portfolioId);
    });

    beforeEach(async () => {
        await rebalanceLockService.releaseLock(portfolioId);
    });

    it('returns 401 when called without admin headers', async () => {
        const res = await request(app)
            .post(`/api/ops/rebalance-lock/${portfolioId}/force-release`);
        expect(res.status).toBe(401);
    });

    it('returns 403 when called with non-admin key', async () => {
        const res = await request(app)
            .post(`/api/ops/rebalance-lock/${portfolioId}/force-release`)
            .set(makeAdminHeaders(nonAdminKp));
        expect(res.status).toBe(403);
    });

    it('rejects forced release when lock is active with a recent heartbeat', async () => {
        // Acquire lock and register a recent heartbeat
        await rebalanceLockService.acquireLock(portfolioId);
        await rebalanceLockService.updateHeartbeat(portfolioId, Date.now());

        const res = await request(app)
            .post(`/api/ops/rebalance-lock/${portfolioId}/force-release`)
            .set(makeAdminHeaders(adminKp))
            .send({ maxStaleMs: 30000 });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
        expect(res.body.error.details?.reason).toBe('LOCK_ACTIVE');

        // Lock should still be held
        const isStillLocked = await rebalanceLockService.isLocked(portfolioId);
        expect(isStillLocked).toBe(true);
    });

    it('successfully force-releases a stale lock missing a recent heartbeat', async () => {
        await rebalanceLockService.acquireLock(portfolioId);
        // Set an old heartbeat timestamp (60 seconds ago)
        await rebalanceLockService.updateHeartbeat(portfolioId, Date.now() - 60000);

        const res = await request(app)
            .post(`/api/ops/rebalance-lock/${portfolioId}/force-release`)
            .set(makeAdminHeaders(adminKp))
            .send({ maxStaleMs: 30000 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.released).toBe(true);
        expect(res.body.data.reason).toBe('STALE_LOCK_RELEASED');

        // Lock should now be cleared
        const isStillLocked = await rebalanceLockService.isLocked(portfolioId);
        expect(isStillLocked).toBe(false);
    });
});
