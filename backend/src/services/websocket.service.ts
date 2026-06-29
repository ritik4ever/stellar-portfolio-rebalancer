import { WebSocketServer, WebSocket } from 'ws';
import {
  WSMessageSchema,
  PROTOCOL_VERSION,
  type WSSessionMetadata,
  HEARTBEAT_INTERVAL_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_SUGGESTED_BACKOFF_MS
} from '../types/websocket.js';
import { verifyAccessTokenForWebSocket } from '../middleware/requireJwt.js';
import { getAuthConfig } from './authService.js';
import { logger } from '../utils/logger.js';
import { ReflectorService } from './reflector.js';

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
  isSubscribed?: boolean;
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

function sendWsMessage(ws: WebSocket, message: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    ...message,
    version: PROTOCOL_VERSION,
    timestamp: Date.now()
  }));
}

export function broadcastPortfolioEvent(payload: PortfolioEventPayload): void {
  if (!attachedServer) return;
  const message = JSON.stringify({
    type: 'portfolio_update',
    version: PROTOCOL_VERSION,
    portfolioId: payload.portfolioId,
    event: payload.event,
    data: payload.data ?? {},
    timestamp: new Date().toISOString()
  });

  attachedServer.clients.forEach((ws) => {
    const client = ws as ExtWebSocket;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!client.isSubscribed) return;
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
      if (client.isSubscribed) {
        sendWsMessage(ws, {
          type: 'HEARTBEAT',
          payload: {
            serverTime: Date.now(),
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
            reconnectPolicy: {
              maxAttempts: RECONNECT_MAX_ATTEMPTS,
              suggestedBackoffMs: RECONNECT_SUGGESTED_BACKOFF_MS
            }
          }
        });
      }
    });
  }, HEARTBEAT_INTERVAL_MS);

  const PRICE_BROADCAST_INTERVAL_MS = 30_000;
  const reflectorService = new ReflectorService();
  const priceBroadcastInterval = setInterval(async () => {
    if (!attachedServer || attachedServer.clients.size === 0) return;
    try {
      const { prices, feedMeta } = await reflectorService.getCurrentPricesWithMeta();
      const message = JSON.stringify({
        type: 'PRICE_UPDATE',
        version: PROTOCOL_VERSION,
        payload: { prices, feedMeta },
        timestamp: Date.now(),
      });
      attachedServer.clients.forEach((ws) => {
        const client = ws as ExtWebSocket;
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!client.isSubscribed) return;
        ws.send(message);
      });
    } catch (err) {
      logger.warn('[WS] Price broadcast failed', { error: String(err) });
    }
  }, PRICE_BROADCAST_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(interval);
    clearInterval(priceBroadcastInterval);
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

    ws.send(JSON.stringify({
      type: 'CONNECTION_ACK',
      message: 'Validation and Monitoring Active',
      version: PROTOCOL_VERSION,
      payload: {
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        reconnectPolicy: {
          maxAttempts: RECONNECT_MAX_ATTEMPTS,
          suggestedBackoffMs: RECONNECT_SUGGESTED_BACKOFF_MS
        }
      },
      sessionMetadata: extWs.sessionMetadata ? {
        authenticatedAt: extWs.sessionMetadata.authenticatedAt,
        tokenExpiresAt: extWs.sessionMetadata.tokenExpiresAt
      } : undefined
    }));

    ws.on('pong', () => {
      extWs.isAlive = true;
    });



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

        switch (validated.type) {
          case 'PING':
            logger.debug('[WS] Received PING', { userId: extWs.userId });
            sendWsMessage(ws, { type: 'PONG' });
            break;
          case 'PONG':
            logger.debug('[WS] Received PONG', { userId: extWs.userId });
            break;
          case 'SUBSCRIBE':
            extWs.isSubscribed = true;
            logger.info('[WS] Client subscribed to realtime updates', { userId: extWs.userId });
            sendWsMessage(ws, {
              type: 'SUBSCRIBED',
              payload: {
                serverTime: Date.now(),
                heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
                reconnectPolicy: {
                  maxAttempts: RECONNECT_MAX_ATTEMPTS,
                  suggestedBackoffMs: RECONNECT_SUGGESTED_BACKOFF_MS
                },
                subscribed: true
              }
            });
            break;
          default:
            logger.warn('[WS] Unsupported WS message type', { type: validated.type, userId: extWs.userId });
            sendWsMessage(ws, {
              type: 'ERROR',
              payload: `Unsupported message type: ${validated.type}. Expected PING or SUBSCRIBE.`
            });
        }

        } catch (err) {
          sendWsMessage(ws, {
            type: 'ERROR',
            payload: `Incompatible version or format. Use v${PROTOCOL_VERSION}`
          });
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
