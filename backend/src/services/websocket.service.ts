import { WebSocketServer, WebSocket } from 'ws';

import { logger } from '../utils/logger.js';

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
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(interval);
    attachedServer = null;
  });

  wss.on('connection', (ws: WebSocket, req: any) => {
    const extWs = ws as ExtWebSocket;
    extWs.isAlive = true;


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
