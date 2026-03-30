import { WebSocketServer, WebSocket } from 'ws';
import { WSMessageSchema, PROTOCOL_VERSION } from '../types/websocket.js';
import { logger } from '../utils/logger.js';

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
}

let attachedServer: WebSocketServer | null = null;

export function getWebSocketServer(): WebSocketServer | null {
  return attachedServer;
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

  wss.on('connection', (ws: WebSocket) => {
    const extWs = ws as ExtWebSocket;
    extWs.isAlive = true;

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