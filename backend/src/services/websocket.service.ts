import { WebSocketServer, WebSocket } from 'ws';
import { WSMessageSchema, PROTOCOL_VERSION, type WSSessionMetadata } from '../types/websocket.js';
import { verifyAccessTokenForWebSocket } from '../middleware/requireJwt.js';
import { getAuthConfig } from './authService.js';
import { logger } from '../utils/logger.js';

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
  sessionMetadata?: WSSessionMetadata;
}

let attachedServer: WebSocketServer | null = null;

export function getWebSocketServer(): WebSocketServer | null {
  return attachedServer;
}

interface PortfolioEventPayload {
  portfolioId: string;
  event: string;
  userId?: string;
  data?: Record<string, unknown>;
}

export function broadcastPortfolioEvent(payload: PortfolioEventPayload): void {
  if (!attachedServer) return;
  const message = JSON.stringify({
    type: 'portfolio_update',
    portfolioId: payload.portfolioId,
    event: payload.event,
    data: payload.data ?? {},
    timestamp: new Date().toISOString()
  });

  attachedServer.clients.forEach((ws) => {
    const client = ws as ExtWebSocket;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (payload.userId && client.userId !== payload.userId) return;
    ws.send(message);
  });
}

/**
 * Extract JWT token from WebSocket upgrade request
 * Supports both Authorization header and query parameter (for browsers)
 */
function extractTokenFromRequest(req: any): string | null {
  // Try Authorization header first (standard)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Fall back to query parameter (for browser WebSocket clients)
  const url = new URL(req.url || '', 'ws://localhost');
  return url.searchParams.get('token');
}

export const initRobustWebSocket = (wss: WebSocketServer) => {
  attachedServer = wss;
  const authConfig = getAuthConfig();

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as ExtWebSocket;
      
      // Check token expiry
      if (client.sessionMetadata) {
        const now = Date.now();
        if (now >= client.sessionMetadata.tokenExpiryTimestamp * 1000) {
          logger.info('[WS] Terminating connection — token expired', {
            userId: client.userId,
            expiredAt: client.sessionMetadata.tokenExpiresAt
          });
          ws.close(
            1008, // Policy Violation
            `Token expired at ${client.sessionMetadata.tokenExpiresAt}`
          );
          return;
        }
      }

      if (client.isAlive === false) {
        logger.info('[WS] Terminating inactive connection', { userId: client.userId });
        return ws.terminate();
      }
      client.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
    attachedServer = null;
  });

  wss.on('connection', (ws: WebSocket, req: any) => {
    const extWs = ws as ExtWebSocket;
    extWs.isAlive = true;

    // === HARDENED HANDSHAKE: Validate JWT authorization ===
    if (authConfig.enabled) {
      const token = extractTokenFromRequest(req);
      const verification = verifyAccessTokenForWebSocket(token ?? '');

      if (!verification.ok) {
        logger.warn('[WS] Connection rejected — auth failed', {
          reason: verification.reason,
          message: verification.message
        });
        ws.close(
          1008, // Policy Violation
          `Authentication failed: ${verification.message}`
        );
        return;
      }

      // Store authenticated session metadata
      extWs.userId = verification.payload.sub;
      extWs.sessionMetadata = {
        userId: verification.payload.sub,
        authenticatedAt: new Date().toISOString(),
        tokenExpiresAt: verification.expiresAt.toISOString(),
        tokenExpiryTimestamp: Math.floor(verification.expiresAt.getTime() / 1000)
      };

      logger.info('[WS] Client authenticated and connected', {
        userId: extWs.userId,
        expiresAt: extWs.sessionMetadata.tokenExpiresAt
      });
    } else {
      // Fallback: read userId from query params (dev/test mode only)
      const requestUrl = req.url ?? '';
      const wsUrl = new URL(requestUrl, 'ws://localhost');
      extWs.userId = wsUrl.searchParams.get('userId') ?? undefined;
      logger.info('[WS] Client connected (auth disabled)', { userId: extWs.userId });
    }

    ws.on('pong', () => {
      extWs.isAlive = true;
    });

    ws.send(JSON.stringify({
      type: 'connection',
      message: 'Validation and Monitoring Active',
      version: PROTOCOL_VERSION,
      sessionMetadata: extWs.sessionMetadata ? {
        authenticatedAt: extWs.sessionMetadata.authenticatedAt,
        tokenExpiresAt: extWs.sessionMetadata.tokenExpiresAt
      } : undefined
    }));

    ws.on('message', (rawData) => {
      extWs.isAlive = true;

      // Re-validate token on each message if auth is enabled
      if (authConfig.enabled && extWs.sessionMetadata) {
        const now = Date.now();
        if (now >= extWs.sessionMetadata.tokenExpiryTimestamp * 1000) {
          logger.warn('[WS] Message rejected — token expired', {
            userId: extWs.userId
          });
          ws.close(
            1008, // Policy Violation
            `Token expired at ${extWs.sessionMetadata.tokenExpiresAt}`
          );
          return;
        }
      }

      try {
        const parsed = JSON.parse(rawData.toString());
        const validated = WSMessageSchema.parse(parsed);

        if (validated.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', version: PROTOCOL_VERSION }));
        }
      } catch {
        logger.warn('[WS] Rejecting invalid message format', { userId: extWs.userId });
        ws.send(JSON.stringify({
          type: 'ERROR',
          payload: `Incompatible version or format. Use v${PROTOCOL_VERSION}`
        }));
      }
    });

    ws.on('close', (_code, reason) => {
      logger.info('[WS] Client disconnected', {
        userId: extWs.userId,
        reason: reason.toString()
      });
    });

    ws.on('error', (error) => {
      logger.error('[WS] Connection error', {
        userId: extWs.userId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });
};