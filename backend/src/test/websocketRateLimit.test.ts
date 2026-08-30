import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import {
  initRobustWebSocket,
  setWebSocketRateLimitConfig,
  getWebSocketRateLimitConfig
} from "../services/websocket.service.js";
import { PROTOCOL_VERSION } from "../types/websocket.js";

function connectAndAwaitGreeting(
  port: number,
  query = ""
): Promise<{ ws: WebSocket; greeting: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${query}`);
    ws.once("message", (data) =>
      resolve({ ws, greeting: JSON.parse(data.toString()) })
    );
    ws.once("error", reject);
  });
}

async function createTestServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  initRobustWebSocket(wss);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res) => {
            wss.clients.forEach((c) => c.terminate());
            wss.close(() => server.close(() => res()));
          }),
      });
    });
  });
}

describe("WebSocket Per-Connection Message Rate Limiter", () => {
  let port: number;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ port, close } = await createTestServer());
    setWebSocketRateLimitConfig({
      enabled: true,
      maxMessagesPerWindow: 3,
      windowMs: 2000
    });
  });

  afterEach(async () => {
    setWebSocketRateLimitConfig({
      enabled: true,
      maxMessagesPerWindow: 10,
      windowMs: 1000
    });
    await close();
  });

  it("exposes current rate limit configuration", () => {
    const config = getWebSocketRateLimitConfig();
    expect(config.enabled).toBe(true);
    expect(config.maxMessagesPerWindow).toBe(3);
    expect(config.windowMs).toBe(2000);
  });

  it("allows messages under the configured rate limit", async () => {
    const { ws } = await connectAndAwaitGreeting(port);

    // Send 3 messages (the limit)
    for (let i = 0; i < 3; i++) {
      ws.send(
        JSON.stringify({
          version: PROTOCOL_VERSION,
          type: "PING",
          timestamp: Date.now(),
        })
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("disconnects a connection that exceeds the configured rate limit", async () => {
    const { ws } = await connectAndAwaitGreeting(port);

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    // Send 4 messages (limit is 3)
    for (let i = 0; i < 4; i++) {
      ws.send(
        JSON.stringify({
          version: PROTOCOL_VERSION,
          type: "PING",
          timestamp: Date.now(),
        })
      );
    }

    const closeResult = await closePromise;
    expect(closeResult.code).toBe(1008);
    expect(closeResult.reason).toContain("Rate limit exceeded");
  });
});
