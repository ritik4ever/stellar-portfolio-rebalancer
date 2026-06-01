import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { initRobustWebSocket } from "../services/websocket.service.js";

const CURRENT_SECRET = "c".repeat(32);

interface TestServer {
  port: number;
  close: () => Promise<void>;
}

async function createTestServer(authEnabled = true): Promise<TestServer> {
  // Set auth config before creating server
  if (!authEnabled) {
    vi.stubEnv("AUTH_ENABLED", "false");
  } else {
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("JWT_SECRET", CURRENT_SECRET);
  }

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

function createValidToken(expiresIn = "15m"): string {
  return jwt.sign(
    { sub: "GVALIDUSER123", type: "access" },
    CURRENT_SECRET,
    { expiresIn },
  );
}

function waitForCloseOrMessage(
  ws: WebSocket,
): Promise<{ type: "close"; code?: number; reason?: string } | { type: "message"; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Wait timeout")), 3000);

    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ type: "close", code, reason: reason?.toString() });
    });

    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve({ type: "message", data: JSON.parse(data.toString()) });
    });

    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("WebSocket JWT authorization hardening (Issue #448)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("when auth is enabled", () => {
    it("rejects connection without token with policy violation close code", async () => {
      const server = await createTestServer(true);

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}`);
        const result = await waitForCloseOrMessage(ws);

        expect(result.type).toBe("close");
        expect(result.code).toBe(1008); // Policy Violation
        expect(result.reason).toContain("Authentication failed");
      } finally {
        await server.close();
      }
    });

    it("accepts connection with valid token in Authorization header", async () => {
      const server = await createTestServer(true);

      try {
        const token = createValidToken();
        const ws = new WebSocket(
          `ws://localhost:${server.port}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        const result = await waitForCloseOrMessage(ws);

        expect(result.type).toBe("message");
        expect(result.data.type).toBe("connection");
        expect(result.data.sessionMetadata).toBeDefined();
        expect(result.data.sessionMetadata.authenticatedAt).toBeDefined();
        expect(result.data.sessionMetadata.tokenExpiresAt).toBeDefined();

        ws.close();
      } finally {
        await server.close();
      }
    });

    it("accepts connection with valid token in query parameter", async () => {
      const server = await createTestServer(true);

      try {
        const token = createValidToken();
        const ws = new WebSocket(`ws://localhost:${server.port}?token=${encodeURIComponent(token)}`);

        const result = await waitForCloseOrMessage(ws);

        expect(result.type).toBe("message");
        expect(result.data.type).toBe("connection");
        expect(result.data.sessionMetadata).toBeDefined();

        ws.close();
      } finally {
        await server.close();
      }
    });

    it("rejects connection with expired token", async () => {
      const server = await createTestServer(true);

      try {
        const expiredToken = createValidToken("-1m"); // Already expired
        const ws = new WebSocket(
          `ws://localhost:${server.port}`,
          {
            headers: { Authorization: `Bearer ${expiredToken}` },
          },
        );

        const result = await waitForCloseOrMessage(ws);

        expect(result.type).toBe("close");
        expect(result.code).toBe(1008);
        expect(result.reason).toContain("Authentication failed");
      } finally {
        await server.close();
      }
    });

    it("rejects connection with invalid token", async () => {
      const server = await createTestServer(true);

      try {
        const ws = new WebSocket(
          `ws://localhost:${server.port}`,
          {
            headers: { Authorization: "Bearer invalid.token.here" },
          },
        );

        const result = await waitForCloseOrMessage(ws);

        expect(result.type).toBe("close");
        expect(result.code).toBe(1008);
        expect(result.reason).toContain("Authentication failed");
      } finally {
        await server.close();
      }
    });

    it("includes token expiry in connection metadata", async () => {
      const server = await createTestServer(true);

      try {
        const token = createValidToken("30m");
        const ws = new WebSocket(
          `ws://localhost:${server.port}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        const result = await waitForCloseOrMessage(ws);

        expect(result.type).toBe("message");
        expect(result.data.sessionMetadata).toBeDefined();
        const metadata = result.data.sessionMetadata as { tokenExpiresAt?: string };
        expect(metadata.tokenExpiresAt).toBeDefined();
        expect(new Date(metadata.tokenExpiresAt!).getTime()).toBeGreaterThan(Date.now());

        ws.close();
      } finally {
        await server.close();
      }
    });

    it("closes connection when token expires during session", async () => {
      const server = await createTestServer(true);

      try {
        const token = createValidToken("5m"); // 5 minutes
        const ws = new WebSocket(
          `ws://localhost:${server.port}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        // Wait for connection
        const greeting = await waitForCloseOrMessage(ws);
        expect(greeting.type).toBe("message");

        // Advance time past token expiry (30s heartbeat check)
        vi.advanceTimersByTime(6 * 60 * 1000 + 30_000); // 6:30 minutes

        // Wait for server to detect expired token and close
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (ws.readyState === WebSocket.CLOSED) {
              clearInterval(checkInterval);
              resolve(null);
            }
          }, 100);
          setTimeout(() => clearInterval(checkInterval), 2000);
        });

        expect(ws.readyState).toBe(WebSocket.CLOSED);
      } finally {
        await server.close();
      }
    });

    it("requires valid token on message reception", async () => {
      const server = await createTestServer(true);

      try {
        const token = createValidToken("1m");
        const ws = new WebSocket(
          `ws://localhost:${server.port}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        // Wait for connection
        const greeting = await waitForCloseOrMessage(ws);
        expect(greeting.type).toBe("message");

        // Advance past token expiry
        vi.advanceTimersByTime(2 * 60 * 1000);

        // Send message after expiry
        ws.send(
          JSON.stringify({
            version: "1.0.0",
            type: "PING",
            timestamp: Date.now(),
          }),
        );

        // Server should close connection due to expired token
        const result = await waitForCloseOrMessage(ws);
        expect(result.type).toBe("close");
        expect(result.code).toBe(1008);
      } finally {
        await server.close();
      }
    });
  });

  describe("when auth is disabled", () => {
    it("accepts connection without token", async () => {
      const server = await createTestServer(false);

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}`);

        const result = await waitForCloseOrMessage(ws);

        expect(result.type).toBe("message");
        expect(result.data.type).toBe("connection");
        expect(result.data.sessionMetadata).toBeUndefined();

        ws.close();
      } finally {
        await server.close();
      }
    });

    it("accepts connection with query parameter userId (backward compat)", async () => {
      const server = await createTestServer(false);

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}?userId=test-user-123`);

        const result = await waitForCloseOrMessage(ws);

        expect(result.type).toBe("message");
        expect(result.data.type).toBe("connection");

        ws.close();
      } finally {
        await server.close();
      }
    });
  });
});
