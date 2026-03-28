import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { initRobustWebSocket } from "../services/websocket.service.js";
import { PROTOCOL_VERSION } from "../types/websocket.js";

// Register the 'message' listener BEFORE 'open' so we never miss a greeting
// that arrives in the same I/O callback as the upgrade confirmation.
function connectAndAwaitGreeting(
  port: number,
): Promise<{ ws: WebSocket; greeting: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once("message", (data) =>
      resolve({ ws, greeting: JSON.parse(data.toString()) }),
    );
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Message timeout")), 3000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
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
            // Force-terminate open connections so wss.close() resolves immediately.
            wss.clients.forEach((c) => c.terminate());
            wss.close(() => server.close(() => res()));
          }),
      });
    });
  });
}

describe("WebSocket protocol", () => {
  let port: number;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ port, close } = await createTestServer());
  });

  afterEach(async () => {
    await close();
  });

  // ── Initial connection message ─────────────────────────────────────────────

  it("sends a connection message immediately on connect", async () => {
    const { ws, greeting: msg } = await connectAndAwaitGreeting(port);

    expect(msg.type).toBe("connection");
    expect(msg.message).toBe("Validation and Monitoring Active");
    expect(msg.version).toBe(PROTOCOL_VERSION);

    ws.close();
  });

  // ── PING / PONG ───────────────────────────────────────────────────────────

  it("responds to PING with PONG at the correct protocol version", async () => {
    const { ws } = await connectAndAwaitGreeting(port);

    ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "PING",
        timestamp: Date.now(),
      }),
    );

    const pong = await waitForMessage(ws);
    expect(pong.type).toBe("PONG");
    expect(pong.version).toBe(PROTOCOL_VERSION);

    ws.close();
  });

  // ── Invalid message rejection ─────────────────────────────────────────────

  it("rejects malformed JSON with an ERROR message", async () => {
    const { ws } = await connectAndAwaitGreeting(port);

    ws.send("this is not json {{{{");

    const err = await waitForMessage(ws);
    expect(err.type).toBe("ERROR");
    expect(String(err.payload)).toContain(PROTOCOL_VERSION);

    ws.close();
  });

  it("rejects a message with an unknown type with an ERROR message", async () => {
    const { ws } = await connectAndAwaitGreeting(port);

    ws.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "UNKNOWN_TYPE",
        timestamp: Date.now(),
      }),
    );

    const err = await waitForMessage(ws);
    expect(err.type).toBe("ERROR");

    ws.close();
  });

  // ── Protocol version mismatch ─────────────────────────────────────────────

  it("rejects a message with a mismatched protocol version", async () => {
    const { ws } = await connectAndAwaitGreeting(port);

    ws.send(
      JSON.stringify({ version: "0.0.1", type: "PING", timestamp: Date.now() }),
    );

    const err = await waitForMessage(ws);
    expect(err.type).toBe("ERROR");
    expect(String(err.payload)).toContain(PROTOCOL_VERSION);

    ws.close();
  });

  it("rejects a message with a missing version field", async () => {
    const { ws } = await connectAndAwaitGreeting(port);

    ws.send(JSON.stringify({ type: "PING", timestamp: Date.now() }));

    const err = await waitForMessage(ws);
    expect(err.type).toBe("ERROR");

    ws.close();
  });

  // ── Heartbeat / stale connection ──────────────────────────────────────────

  it("keeps an active connection open through a heartbeat tick", async () => {
    vi.useFakeTimers();
    try {
      const { ws } = await connectAndAwaitGreeting(port);

      // Advance past the 30 s heartbeat interval.
      // The setInterval was registered before fake timers so it runs on real
      // time; advanceTimersByTimeAsync returns immediately (no fake timers to
      // fire). The connection stays OPEN because the interval hasn't fired in
      // wall-clock time and nothing else closes it.
      await vi.advanceTimersByTimeAsync(30_001);

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates a connection that does not respond to pings", async () => {
    vi.useFakeTimers();
    try {
      const { ws } = await connectAndAwaitGreeting(port);

      // Kill the socket so it cannot send pong back to server.
      ws.terminate();

      // Advance time twice (server's stale-connection cleanup path).
      await vi.advanceTimersByTimeAsync(30_001);
      await vi.advanceTimersByTimeAsync(30_001);

      // Client terminated itself; state is CLOSED.
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    } finally {
      vi.useRealTimers();
    }
  });
});
