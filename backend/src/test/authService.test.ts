import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";

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
