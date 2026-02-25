import { WebSocketServer, WebSocket } from 'ws';
import { WSMessageSchema, PROTOCOL_VERSION } from '../types/websocket.js';


interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
}

export const initRobustWebSocket = (wss: WebSocketServer) => {
  
  
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as ExtWebSocket;
      if (client.isAlive === false) {
        console.log("[WS] Terminating inactive connection...");
        return ws.terminate(); 
      }
      client.isAlive = false; 
      ws.ping(); 
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  wss.on('connection', (ws: WebSocket) => {
    const extWs = ws as ExtWebSocket; 
    extWs.isAlive = true;
    
    console.log("[WS] Client connected to port 3002");

    
    ws.on('pong', () => { 
      extWs.isAlive = true; 
    });

    
    ws.send(JSON.stringify({ 
      type: "connection", 
      message: "Validation and Monitoring Active", 
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
      } catch (error) {
        
        console.error("[WS] Rejecting invalid message format");
        ws.send(JSON.stringify({ 
          type: 'ERROR', 
          payload: `Incompatible version or format. Use v${PROTOCOL_VERSION}` 
        }));
      }
    });
  });
};