import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import express from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { Buffer } from 'node:buffer';
import { credentialManager } from '../config/credentialManager.js';
import { getPool, refreshDbPool, refreshDbPoolSync, resetDbPool, query, isDbConfigured } from '../db/client.js';
import { getRedisUrl, refreshRedisCredentials } from '../queue/connection.js';

function makeAdminHeaders(kp: Keypair) {
    const msg = Date.now().toString();
    const sig = kp.sign(Buffer.from(msg, 'utf8')).toString('base64');
    return {
        'x-public-key': kp.publicKey(),
        'x-message': msg,
        'x-signature': sig,
    };
}

function createApp() {
    const app = express();
    app.use(express.json());
    app.set('trust proxy', 1);
    // Import ops router dynamically
    return app;
}

describe('Credential rotation and dynamic configuration (#rds-secret-rotation)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.clearAllMocks();
        resetDbPool();
        credentialManager.clearCache();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        resetDbPool();
        credentialManager.clearCache();
    });

    describe('CredentialManager database credentials resolution', () => {
        it('resolves database credentials from environment variables', () => {
            process.env.PGHOST = 'localhost';
            process.env.PGUSER = 'dbadmin';
            process.env.PGPASSWORD = 'initial-secret-password';
            process.env.PGDATABASE = 'stellar_portfolio';

            const creds = credentialManager.getDbCredentialsSync(true);
            expect(creds.host).toBe('localhost');
            expect(creds.user).toBe('dbadmin');
            expect(creds.password).toBe('initial-secret-password');
            expect(creds.database).toBe('stellar_portfolio');
            expect(creds.source).toBe('env');
        });

        it('returns rotated credentials when forceRefresh is requested after rotation', () => {
            process.env.PGHOST = 'localhost';
            process.env.PGUSER = 'dbadmin';
            process.env.PGPASSWORD = 'password-v1';
            process.env.PGDATABASE = 'stellar_portfolio';

            const creds1 = credentialManager.getDbCredentialsSync(true);
            expect(creds1.password).toBe('password-v1');

            // Simulate AWS Secrets Manager / environment rotation event
            process.env.PGPASSWORD = 'password-v2-rotated';

            const creds2 = credentialManager.getDbCredentialsSync(true);
            expect(creds2.password).toBe('password-v2-rotated');
        });

        it('reports isDbConfigured correctly', () => {
            delete process.env.DATABASE_URL;
            delete process.env.PGHOST;
            delete process.env.PGUSER;
            delete process.env.PGDATABASE;

            expect(credentialManager.isDbConfigured()).toBe(false);
            expect(isDbConfigured()).toBe(false);

            process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/test';
            expect(credentialManager.isDbConfigured()).toBe(true);
            expect(isDbConfigured()).toBe(true);
        });
    });

    describe('CredentialManager Redis credentials resolution', () => {
        it('injects REDIS_AUTH_TOKEN into REDIS_URL when not already embedded', () => {
            process.env.REDIS_URL = 'redis://redis-cluster.aws.internal:6379';
            process.env.REDIS_AUTH_TOKEN = 'secret-redis-token-123';

            const url = credentialManager.getRedisUrl(true);
            expect(url).toBe('redis://:secret-redis-token-123@redis-cluster.aws.internal:6379');
        });

        it('updates Redis URL dynamically across rotation events', async () => {
            process.env.REDIS_URL = 'redis://redis-cluster.aws.internal:6379';
            process.env.REDIS_AUTH_TOKEN = 'token-v1';

            const url1 = getRedisUrl(true);
            expect(url1).toBe('redis://:token-v1@redis-cluster.aws.internal:6379');

            // Rotate token
            process.env.REDIS_AUTH_TOKEN = 'token-v2-rotated';

            const url2 = await refreshRedisCredentials();
            expect(url2).toBe('redis://:token-v2-rotated@redis-cluster.aws.internal:6379');
        });
    });

    describe('Database connection pool rotation tolerance', () => {
        it('refreshDbPool closes old pool and creates new pool with updated password', async () => {
            process.env.DATABASE_URL = 'postgresql://dbadmin:pass-v1@localhost:5432/test';
            const pool1 = getPool(true);
            expect(pool1).toBeDefined();

            process.env.DATABASE_URL = 'postgresql://dbadmin:pass-v2-rotated@localhost:5432/test';
            const pool2 = await refreshDbPool();

            expect(pool2).toBeDefined();
            expect(pool2).not.toBe(pool1);
        });

        it('refreshDbPoolSync works synchronously for non-async callers', () => {
            process.env.DATABASE_URL = 'postgresql://dbadmin:pass-v1@localhost:5432/test';
            const pool1 = getPool(true);

            process.env.DATABASE_URL = 'postgresql://dbadmin:pass-v2@localhost:5432/test';
            const pool2 = refreshDbPoolSync();
            expect(pool2).toBeDefined();
            expect(pool2).not.toBe(pool1);
        });

        it('query() automatically refreshes DB pool and retries on PostgreSQL password auth error (code 28P01)', async () => {
            process.env.DATABASE_URL = 'postgresql://dbadmin:oldpass@localhost:5432/test';

            let attempt = 0;
            const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
                attempt++;
                if (attempt === 1) {
                    const authErr = new Error('password authentication failed for user "dbadmin"');
                    (authErr as any).code = '28P01';
                    throw authErr;
                }
                return { rows: [{ success: true }], rowCount: 1 };
            });

            const spy = vi.spyOn(pg.Pool.prototype, 'query' as any).mockImplementation(mockQuery);

            // Set rotated password in env so refreshDbPool picks it up
            process.env.DATABASE_URL = 'postgresql://dbadmin:newrotatedpass@localhost:5432/test';

            try {
                const result = await query('SELECT 1');
                expect(result.rows).toEqual([{ success: true }]);
                expect(attempt).toBe(2);
            } finally {
                spy.mockRestore();
            }
        });

        it('query() automatically refreshes DB pool on SASL/auth error message', async () => {
            process.env.DATABASE_URL = 'postgresql://dbadmin:oldpass@localhost:5432/test';

            let attempt = 0;
            const mockQuery = vi.fn().mockImplementation(async () => {
                attempt++;
                if (attempt === 1) {
                    throw new Error('SASL authentication failed');
                }
                return { rows: [{ ok: 1 }], rowCount: 1 };
            });

            const spy = vi.spyOn(pg.Pool.prototype, 'query' as any).mockImplementation(mockQuery);

            try {
                const result = await query('SELECT 1');
                expect(result.rows).toEqual([{ ok: 1 }]);
                expect(attempt).toBe(2);
            } finally {
                spy.mockRestore();
            }
        });

        it('query() rethrows non-auth errors without refreshing pool', async () => {
            process.env.DATABASE_URL = 'postgresql://dbadmin:pass@localhost:5432/test';

            const mockQuery = vi.fn().mockRejectedValue(new Error('syntax error at or near "SELECT"'));
            const spy = vi.spyOn(pg.Pool.prototype, 'query' as any).mockImplementation(mockQuery);

            try {
                await expect(query('SELECT * FROM non_existent')).rejects.toThrow('syntax error');
                expect(mockQuery).toHaveBeenCalledTimes(1);
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe('Ops Credential Rotation endpoints', () => {
        it('GET /api/ops/credentials/status returns 200 with credential status', async () => {
            const adminKp = Keypair.random();
            process.env.ADMIN_PUBLIC_KEYS = adminKp.publicKey();
            process.env.DATABASE_URL = 'postgresql://dbadmin:secret@localhost:5432/test';

            const app = express();
            app.use(express.json());
            const { opsRouter } = await import('../api/ops.routes.js');
            app.use('/api/ops', opsRouter);

            const res = await request(app)
                .get('/api/ops/credentials/status')
                .set(makeAdminHeaders(adminKp))
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.database.configured).toBe(true);
            expect(res.body.data.redis).toBeDefined();
        });

        it('POST /api/ops/credentials/refresh refreshes DB pool and Redis credentials', async () => {
            const adminKp = Keypair.random();
            process.env.ADMIN_PUBLIC_KEYS = adminKp.publicKey();
            process.env.DATABASE_URL = 'postgresql://dbadmin:secret2@localhost:5432/test';

            const app = express();
            app.use(express.json());
            const { opsRouter } = await import('../api/ops.routes.js');
            app.use('/api/ops', opsRouter);

            const res = await request(app)
                .post('/api/ops/credentials/refresh')
                .set(makeAdminHeaders(adminKp))
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.database.refreshed).toBe(true);
            expect(res.body.data.redis.refreshed).toBe(true);
        });
    });
});
