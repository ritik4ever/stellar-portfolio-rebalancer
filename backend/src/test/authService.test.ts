import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";

vi.mock("../db/refreshTokenDb.js", () => ({
  createRefreshToken: vi.fn(() => Promise.resolve()),
  findRefreshToken: vi.fn(() => Promise.resolve(null)),
  deleteRefreshTokenById: vi.fn(() => Promise.resolve(true)),
  deleteAllRefreshTokensForUser: vi.fn(() => Promise.resolve(0)),
  generateRefreshTokenId: vi.fn(() => "mock-jti"),
}));

describe("authService – JWT secret enforcement", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getAuthConfig", () => {
    it("returns enabled=false when JWT_SECRET is not set", async () => {
      vi.stubEnv("JWT_SECRET", "");
      const { getAuthConfig } = await import("../services/authService.js");
      expect(getAuthConfig().enabled).toBe(false);
    });

    it("returns enabled=false when JWT_SECRET is shorter than 32 characters", async () => {
      vi.stubEnv("JWT_SECRET", "too-short");
      const { getAuthConfig } = await import("../services/authService.js");
      expect(getAuthConfig().enabled).toBe(false);
    });

    it("returns enabled=false when JWT_SECRET is exactly 31 characters", async () => {
      vi.stubEnv("JWT_SECRET", "a".repeat(31));
      const { getAuthConfig } = await import("../services/authService.js");
      expect(getAuthConfig().enabled).toBe(false);
    });

    it("returns enabled=true when JWT_SECRET is exactly 32 characters", async () => {
      vi.stubEnv("JWT_SECRET", "a".repeat(32));
      const { getAuthConfig } = await import("../services/authService.js");
      expect(getAuthConfig().enabled).toBe(true);
    });

    it("returns enabled=true when JWT_SECRET is longer than 32 characters", async () => {
      vi.stubEnv("JWT_SECRET", "a".repeat(64));
      const { getAuthConfig } = await import("../services/authService.js");
      expect(getAuthConfig().enabled).toBe(true);
    });

    it("exposes correct default expiry values", async () => {
      vi.stubEnv("JWT_SECRET", "a".repeat(32));
      const { getAuthConfig } = await import("../services/authService.js");
      const cfg = getAuthConfig();
      expect(cfg.accessExpirySec).toBe(900);
      expect(cfg.refreshExpirySec).toBe(604800);
    });
  });

  describe("generateAccessToken", () => {
    it("throws when JWT_SECRET is not set", async () => {
      vi.stubEnv("JWT_SECRET", "");
      const { generateAccessToken } =
        await import("../services/authService.js");
      expect(() => generateAccessToken("GTEST")).toThrow(
        /JWT_SECRET must be set/,
      );
    });

    it("throws when JWT_SECRET is too short", async () => {
      vi.stubEnv("JWT_SECRET", "weak");
      const { generateAccessToken } =
        await import("../services/authService.js");
      expect(() => generateAccessToken("GTEST")).toThrow(
        /JWT_SECRET must be set/,
      );
    });

    it("returns a signed JWT string when secret meets the minimum length", async () => {
      vi.stubEnv("JWT_SECRET", "a".repeat(32));
      const { generateAccessToken } =
        await import("../services/authService.js");
      const token = generateAccessToken("GTEST123");
      expect(typeof token).toBe("string");
      const parts = token.split(".");
      expect(parts).toHaveLength(3);
    });

    it("embeds the correct address and type in the token payload", async () => {
      const secret = "b".repeat(32);
      vi.stubEnv("JWT_SECRET", secret);
      const { generateAccessToken } =
        await import("../services/authService.js");
      const token = generateAccessToken("GADDRESS");
      const decoded = jwt.decode(token) as Record<string, unknown>;
      expect(decoded.sub).toBe("GADDRESS");
      expect(decoded.type).toBe("access");
    });
  });

  describe("verifyAccessToken", () => {
    it("throws when JWT_SECRET is not set", async () => {
      vi.stubEnv("JWT_SECRET", "");
      const { verifyAccessToken } = await import("../services/authService.js");
      expect(() => verifyAccessToken("any.token.here")).toThrow(
        /JWT_SECRET must be set/,
      );
    });

    it("throws when JWT_SECRET is too short", async () => {
      vi.stubEnv("JWT_SECRET", "short");
      const { verifyAccessToken } = await import("../services/authService.js");
      expect(() => verifyAccessToken("any.token.here")).toThrow(
        /JWT_SECRET must be set/,
      );
    });

    it("returns null for a malformed token", async () => {
      vi.stubEnv("JWT_SECRET", "c".repeat(32));
      const { verifyAccessToken } = await import("../services/authService.js");
      expect(verifyAccessToken("not.a.valid.jwt")).toBeNull();
    });

    it("returns null for a token signed with a different secret", async () => {
      vi.stubEnv("JWT_SECRET", "d".repeat(32));
      const other = jwt.sign({ sub: "GTEST", type: "access" }, "e".repeat(32));
      const { verifyAccessToken } = await import("../services/authService.js");
      expect(verifyAccessToken(other)).toBeNull();
    });

    it("returns null for a refresh token passed to verifyAccessToken", async () => {
      const secret = "f".repeat(32);
      vi.stubEnv("JWT_SECRET", secret);
      const token = jwt.sign({ sub: "GTEST", type: "refresh" }, secret);
      const { verifyAccessToken } = await import("../services/authService.js");
      expect(verifyAccessToken(token)).toBeNull();
    });

    it("returns the payload for a valid access token", async () => {
      const secret = "g".repeat(32);
      vi.stubEnv("JWT_SECRET", secret);
      const { generateAccessToken, verifyAccessToken } =
        await import("../services/authService.js");
      const token = generateAccessToken("GVALID");
      const payload = verifyAccessToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe("GVALID");
      expect(payload?.type).toBe("access");
    });

    it("returns null for an expired token", async () => {
      const secret = "h".repeat(32);
      vi.stubEnv("JWT_SECRET", secret);
      const expired = jwt.sign({ sub: "GTEST", type: "access" }, secret, {
        expiresIn: -1,
      });
      const { verifyAccessToken } = await import("../services/authService.js");
      expect(verifyAccessToken(expired)).toBeNull();
    });
  });

  describe("refreshTokens (rotation)", () => {
    const secret = "a".repeat(32);
    const address = "GADDRESS123";

    beforeEach(() => {
      vi.stubEnv("JWT_SECRET", secret);
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.clearAllMocks();
    });

    it("returns new tokens and rotates (deletes old) on valid refresh", async () => {
      const { refreshTokens } = await import("../services/authService.js");
      const { findRefreshToken, deleteRefreshTokenById, createRefreshToken } =
        await import("../db/refreshTokenDb.js");

      const oldRefreshId = "old-jti";
      const oldRefreshToken = jwt.sign(
        { sub: address, type: "refresh", jti: oldRefreshId },
        secret,
      );

      vi.mocked(findRefreshToken).mockResolvedValueOnce({
        id: oldRefreshId,
        user_address: address,
        token_hash: "old-hash",
        expires_at: new Date(Date.now() + 10000),
        created_at: new Date(),
      });

      const result = await refreshTokens(oldRefreshToken);

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBeDefined();
      expect(result?.refreshToken).toBeDefined();
      expect(result?.refreshToken).not.toBe(oldRefreshToken);

      // Verify rotation: old token deleted, new one created
      expect(deleteRefreshTokenById).toHaveBeenCalledWith(oldRefreshId);
      expect(createRefreshToken).toHaveBeenCalled();
    });

    it("rejects and deletes token if JWT verification fails (e.g. expired)", async () => {
      const { refreshTokens } = await import("../services/authService.js");
      const { findRefreshToken, deleteRefreshTokenById } = await import(
        "../db/refreshTokenDb.js"
      );

      const expiredToken = jwt.sign(
        { sub: address, type: "refresh", jti: "expired-jti" },
        secret,
        { expiresIn: -1 },
      );

      vi.mocked(findRefreshToken).mockResolvedValueOnce({
        id: "expired-jti",
        user_address: address,
        token_hash: "hash",
        expires_at: new Date(Date.now() - 1000), // DB also thinks it's expired
        created_at: new Date(),
      });

      const result = await refreshTokens(expiredToken);
      expect(result).toBeNull();
      // Should delete the expired token from DB
      expect(deleteRefreshTokenById).toHaveBeenCalledWith("expired-jti");
    });

    it("rejects if token type is not refresh", async () => {
      const { refreshTokens } = await import("../services/authService.js");
      const { findRefreshToken } = await import("../db/refreshTokenDb.js");

      const accessToken = jwt.sign(
        { sub: address, type: "access", jti: "not-a-refresh-token" },
        secret,
      );

      vi.mocked(findRefreshToken).mockResolvedValueOnce({
        id: "id",
        user_address: address,
        token_hash: "hash",
        expires_at: new Date(Date.now() + 10000),
        created_at: new Date(),
      });

      const result = await refreshTokens(accessToken);
      expect(result).toBeNull();
    });

    it("prevents reuse by failing if token is not in database", async () => {
      const { refreshTokens } = await import("../services/authService.js");
      const { findRefreshToken } = await import("../db/refreshTokenDb.js");

      vi.mocked(findRefreshToken).mockResolvedValueOnce(null);

      const result = await refreshTokens("some-already-used-token");
      expect(result).toBeNull();
    });
  });

  describe("logout functionality", () => {
    const address = "GADDRESS123";

    beforeEach(() => {
      vi.stubEnv("JWT_SECRET", "a".repeat(32));
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("invalidates a single session by refresh token", async () => {
      const { logout } = await import("../services/authService.js");
      const { findRefreshToken, deleteRefreshTokenById } = await import(
        "../db/refreshTokenDb.js"
      );

      vi.mocked(findRefreshToken).mockResolvedValueOnce({
        id: "target-id",
      } as any);

      const success = await logout("token-to-invalidate", undefined);
      expect(success).toBe(true);
      expect(deleteRefreshTokenById).toHaveBeenCalledWith("target-id");
    });

    it("invalidates all sessions for a user address", async () => {
      const { logout } = await import("../services/authService.js");
      const { deleteAllRefreshTokensForUser } = await import(
        "../db/refreshTokenDb.js"
      );

      vi.mocked(deleteAllRefreshTokensForUser).mockResolvedValueOnce(3);

      const success = await logout(undefined, address);
      expect(success).toBe(true);
      expect(deleteAllRefreshTokensForUser).toHaveBeenCalledWith(address);
    });

    it("returns false if nothing to invalidate", async () => {
      const { logout } = await import("../services/authService.js");
      const { findRefreshToken, deleteAllRefreshTokensForUser } = await import(
        "../db/refreshTokenDb.js"
      );

      vi.mocked(findRefreshToken).mockResolvedValueOnce(null);
      vi.mocked(deleteAllRefreshTokensForUser).mockResolvedValueOnce(0);

      const success = await logout("not-found", "G-NO-TOKENS");
      expect(success).toBe(false);
    });
  });
});

describe("validateStartupConfigOrThrow – JWT_SECRET validation", () => {
  const baseEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    PORT: "3001",
    STELLAR_NETWORK: "testnet",
    STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    STELLAR_CONTRACT_ADDRESS:
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    DEMO_MODE: "true",
    ALLOW_DEMO_BALANCE_FALLBACK: "true",
  };

  it("does not throw and sets jwtAuthEnabled=false when JWT_SECRET is absent", async () => {
    const { validateStartupConfigOrThrow } =
      await import("../config/startupConfig.js");
    const cfg = validateStartupConfigOrThrow({ ...baseEnv });
    expect(cfg.jwtAuthEnabled).toBe(false);
  });

  it("throws at startup when JWT_SECRET is set but shorter than 32 characters", async () => {
    const { validateStartupConfigOrThrow } =
      await import("../config/startupConfig.js");
    expect(() =>
      validateStartupConfigOrThrow({ ...baseEnv, JWT_SECRET: "tooshort" }),
    ).toThrow(/JWT_SECRET is set but only/);
  });

  it("sets jwtAuthEnabled=true when JWT_SECRET is exactly 32 characters", async () => {
    const { validateStartupConfigOrThrow } =
      await import("../config/startupConfig.js");
    const cfg = validateStartupConfigOrThrow({
      ...baseEnv,
      JWT_SECRET: "z".repeat(32),
    });
    expect(cfg.jwtAuthEnabled).toBe(true);
  });

  it("sets jwtAuthEnabled=true when JWT_SECRET is a long hex string", async () => {
    const { validateStartupConfigOrThrow } =
      await import("../config/startupConfig.js");
    const secret =
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    const cfg = validateStartupConfigOrThrow({
      ...baseEnv,
      JWT_SECRET: secret,
    });
    expect(cfg.jwtAuthEnabled).toBe(true);
  });

  it("includes jwtAuthEnabled in buildStartupSummary output", async () => {
    const { validateStartupConfigOrThrow, buildStartupSummary } =
      await import("../config/startupConfig.js");
    const cfg = validateStartupConfigOrThrow({
      ...baseEnv,
      JWT_SECRET: "x".repeat(32),
    });
    const summary = buildStartupSummary(cfg);
    expect(summary).toHaveProperty("jwtAuthEnabled", true);
  });
});
