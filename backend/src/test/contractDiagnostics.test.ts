import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { requireJwt } from '../middleware/requireJwt.js';
import * as contractDiagnostics from '../services/contractDiagnostics.js';
import opsRouter from '../api/ops.routes.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'c'.repeat(32);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/ops', opsRouter);
  return app;
}

function makeToken(sub = 'GVALID123') {
  return jwt.sign({ sub, type: 'access' }, JWT_SECRET, { expiresIn: '15m' });
}

describe('GET /ops/diagnostics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    vi.stubEnv('JWT_PREVIOUS_SECRET', '');
    vi.stubEnv('JWT_PREVIOUS_SECRET_GRACE_UNTIL', '');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns 401 when no token is provided', async () => {
    const app = createApp();
    const res = await request(app).get('/ops/diagnostics').expect(401);
    expect(res.body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for expired token', async () => {
    const token = jwt.sign({ sub: 'GEXPIRED', type: 'access' }, JWT_SECRET, { expiresIn: -1 });
    const app = createApp();
    const res = await request(app)
      .get('/ops/diagnostics')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(res.body.error?.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 for invalid token', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/ops/diagnostics')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401);
    expect(res.body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 with healthy diagnostics summary for valid token', async () => {
    const app = createApp();
    const token = makeToken();
    const res = await request(app)
      .get('/ops/diagnostics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
      lastCheck: expect.any(String),
      details: {
        connectivity: expect.any(String),
        configAlignment: expect.any(String),
        recentFailures: expect.any(Number),
        recentFailureDetails: expect.any(Array),
      },
    });
  });

  it('returns degraded status when recent failures exist', async () => {
    vi.spyOn(contractDiagnostics, 'getContractDiagnostics').mockResolvedValueOnce({
      status: 'degraded',
      lastCheck: new Date().toISOString(),
      details: {
        connectivity: 'connected',
        configAlignment: 'synced',
        recentFailures: 2,
        recentFailureDetails: ['[2026-01-01T00:00:00.000Z] timeout', '[2026-01-01T00:00:01.000Z] rpc error'],
      },
    });

    const app = createApp();
    const token = makeToken();
    const res = await request(app)
      .get('/ops/diagnostics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.details.recentFailures).toBe(2);
    expect(res.body.data.details.recentFailureDetails).toHaveLength(2);
  });

  it('returns 500 when diagnostics service throws', async () => {
    vi.spyOn(contractDiagnostics, 'getContractDiagnostics').mockRejectedValueOnce(
      new Error('service unavailable')
    );

    const app = createApp();
    const token = makeToken();
    const res = await request(app)
      .get('/ops/diagnostics')
      .set('Authorization', `Bearer ${token}`)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('INTERNAL_ERROR');
  });
});
