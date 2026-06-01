import { WebSocketServer, WebSocket } from 'ws';
import {
  WSMessageSchema,
  PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_SUGGESTED_BACKOFF_MS
} from '../types/websocket.js';
import { logger } from '../utils/logger.js';

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
  isSubscribed?: boolean;
  userId?: string;
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

export const initRobustWebSocket = (wss: WebSocketServer) => {
  attachedServer = wss;

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as ExtWebSocket;
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

  wss.on('connection', (ws: WebSocket, req) => {
    const extWs = ws as ExtWebSocket;
    extWs.isAlive = true;
    extWs.isSubscribed = false;
    const requestUrl = req.url ?? '';
    const wsUrl = new URL(requestUrl, 'ws://localhost');
    extWs.userId = wsUrl.searchParams.get('userId') ?? undefined;

    logger.info('[WS] Client connected', { userId: extWs.userId });

    ws.on('pong', () => {
      extWs.isAlive = true;
    });

    sendWsMessage(ws, {
      type: 'CONNECTION_ACK',
      payload: {
        message: 'Validation and Monitoring Active',
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        reconnectPolicy: {
          maxAttempts: RECONNECT_MAX_ATTEMPTS,
          suggestedBackoffMs: RECONNECT_SUGGESTED_BACKOFF_MS
        }
      }
    });

    ws.on('message', (rawData) => {
      extWs.isAlive = true;

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
      } catch (error) {
        logger.warn('[WS] Rejecting invalid message format', { error: String(error), userId: extWs.userId });
        sendWsMessage(ws, {
          type: 'ERROR',
          payload: `Incompatible version or format. Use v${PROTOCOL_VERSION}`
        });
      }
    });
  });
};
