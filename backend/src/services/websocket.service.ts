import { WebSocketServer, WebSocket } from 'ws';
import { WSMessageSchema, PROTOCOL_VERSION } from '../types/websocket.js';
import { logger } from '../utils/logger.js';

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
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

export const initRobustWebSocket = (wss: WebSocketServer) => {
  attachedServer = wss;

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as ExtWebSocket;
      if (client.isAlive === false) {
        logger.info('[WS] Terminating inactive connection');
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

  wss.on('connection', (ws: WebSocket, req) => {
    const extWs = ws as ExtWebSocket;
    extWs.isAlive = true;
    const requestUrl = req.url ?? '';
    const wsUrl = new URL(requestUrl, 'ws://localhost');
    extWs.userId = wsUrl.searchParams.get('userId') ?? undefined;

    logger.info('[WS] Client connected');

    ws.on('pong', () => {
      extWs.isAlive = true;
    });

    ws.send(JSON.stringify({
      type: 'connection',
      message: 'Validation and Monitoring Active',
      version: PROTOCOL_VERSION
    }));

    ws.on('message', (rawData) => {
      extWs.isAlive = true;

      try {
        const parsed = JSON.parse(rawData.toString());

        const validated = WSMessageSchema.parse(parsed);

        if (validated.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', version: PROTOCOL_VERSION }));
        }
      } catch {
        logger.warn('[WS] Rejecting invalid message format');
        ws.send(JSON.stringify({
          type: 'ERROR',
          payload: `Incompatible version or format. Use v${PROTOCOL_VERSION}`
        }));
      }
    });
  });
};