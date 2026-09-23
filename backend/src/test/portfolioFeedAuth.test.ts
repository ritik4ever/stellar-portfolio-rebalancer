import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { generateAccessToken } from '../services/authService.js';
import { portfolioStorage } from '../services/portfolioStorage.js';
import { initPortfolioFeedWebSocket } from '../ws/portfolioFeed.js';

describe('Portfolio WebSocket Feed Auth & Ownership Verification', () => {
    let server: http.Server;
    let wss: WebSocketServer;
    let serverUrl: string;

    const userOwner = 'G_OWNER_ADDRESS_123456789012345678901234567890';
    const userNonOwner = 'G_NON_OWNER_ADDRESS_12345678901234567890123';
    let portfolioId: string;

    beforeAll(async () => {
        process.env.JWT_SECRET = 'super_secret_jwt_key_that_is_long_enough_32_bytes';

        server = http.createServer();
        wss = new WebSocketServer({ server });
        initPortfolioFeedWebSocket(wss);

        await new Promise<void>((resolve) => {
            server.listen(0, () => {
                const addr = server.address() as { port: number };
                serverUrl = `ws://localhost:${addr.port}`;
                resolve();
            });
        });
    });

    afterAll(async () => {
        if (wss) {
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        }
        if (server) {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    beforeEach(async () => {
        portfolioId = portfolioStorage.createPortfolio(userOwner, { XLM: 100 }, 5);
    });

    it('rejects connection when no authentication token is provided', async () => {
        const client = new WebSocket(`${serverUrl}/ws/portfolio/${portfolioId}`);

        const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
            client.on('close', (code, reason) => {
                resolve({ code, reason: reason.toString() });
            });
        });

        const { code, reason } = await closePromise;
        expect(code).toBe(1008);
        expect(reason).toContain('Authentication token missing');
    });

    it('rejects connection when authenticated user does NOT own the portfolio', async () => {
        const nonOwnerToken = generateAccessToken(userNonOwner);
        const client = new WebSocket(`${serverUrl}/ws/portfolio/${portfolioId}?token=${nonOwnerToken}`);

        const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
            client.on('close', (code, reason) => {
                resolve({ code, reason: reason.toString() });
            });
        });

        const { code, reason } = await closePromise;
        expect(code).toBe(1008);
        expect(reason).toContain('Unauthorized portfolio feed access');
    });

    it('accepts connection and sends ACK when authenticated user owns the portfolio', async () => {
        const ownerToken = generateAccessToken(userOwner);
        const client = new WebSocket(`${serverUrl}/ws/portfolio/${portfolioId}?token=${ownerToken}`);

        const messagePromise = new Promise<any>((resolve, reject) => {
            client.on('message', (data) => {
                try {
                    const parsed = JSON.parse(data.toString());
                    resolve(parsed);
                } catch (e) {
                    reject(e);
                }
            });
            client.on('error', reject);
        });

        const ackMessage = await messagePromise;
        expect(ackMessage.type).toBe('CONNECTION_ACK');
        expect(ackMessage.portfolioId).toBe(portfolioId);

        client.close();
    });
});
