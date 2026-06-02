import { getFeatureFlags, type FeatureFlags } from "./featureFlags.js";
import { logger } from "../utils/logger.js";

export interface StartupConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  stellarNetwork: "testnet" | "mainnet";
  stellarHorizonUrl: string;
  stellarContractAddress: string;
  autoRebalancerEnabled: boolean;
  corsOrigins: string[];
  hasRebalanceSigner: boolean;
  jwtAuthEnabled: boolean;
  featureFlags: FeatureFlags;
  metricsAllowlist: string[];
  readinessCacheTtlMs: number;
  consentAuditRetentionDays: number;
  queueStartupRetries: number;
  queueStartupInitialDelayMs: number;
  queueStartupMaxDelayMs: number;
  // Cache tuning configuration
  cacheDurationMs: number;
  priceDataMaxAgeSeconds: number;
  minRequestIntervalMs: number;
  featureFlagsFile?: string;
}

const NODE_ENVS = new Set(["development", "test", "production"]);
const STELLAR_NETWORKS = new Set(["testnet", "mainnet"]);
// Accept both full Soroban strkey length and shorter test placeholders (must start with C/S)
const STELLAR_CONTRACT_REGEX = /^C[A-Z2-7A-Z0-9]{10,}$/;
const STELLAR_SECRET_REGEX = /^S[A-Z2-7A-Z0-9]{10,}$/;

export function validateStartupConfigOrThrow(
  env: NodeJS.ProcessEnv = process.env,
): StartupConfig {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeEnvRaw = (env.NODE_ENV || "development").trim().toLowerCase();
  const nodeEnv = NODE_ENVS.has(nodeEnvRaw)
    ? (nodeEnvRaw as StartupConfig["nodeEnv"])
    : undefined;
  if (!nodeEnv) {
    errors.push(
      `NODE_ENV '${env.NODE_ENV}' is invalid. Allowed values: development, test, production.`,
    );
  }

  const portRaw = (env.PORT || "3001").trim();
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(
      `PORT '${env.PORT}' is invalid. Provide an integer between 1 and 65535.`,
    );
  }

  const featureFlags = getFeatureFlags(env);
  if (nodeEnv === "production" && featureFlags.demoMode) {
    errors.push("DEMO_MODE cannot be true in production.");
  }
  if (nodeEnv === "production" && featureFlags.allowDemoBalanceFallback) {
    warnings.push("ALLOW_DEMO_BALANCE_FALLBACK is enabled in production.");
  }
  if (nodeEnv === "production" && featureFlags.enableDemoDbSeed) {
    warnings.push("ENABLE_DEMO_DB_SEED is enabled in production.");
  }
  if (nodeEnv === "production" && featureFlags.allowMockPriceHistory) {
    warnings.push("ALLOW_MOCK_PRICE_HISTORY is enabled in production.");
  }
  if (nodeEnv === "production" && featureFlags.allowFallbackPrices) {
    warnings.push("ALLOW_FALLBACK_PRICES is enabled in production.");
  }

  const stellarNetworkRaw = (env.STELLAR_NETWORK || "testnet")
    .trim()
    .toLowerCase();
  const stellarNetwork = STELLAR_NETWORKS.has(stellarNetworkRaw)
    ? (stellarNetworkRaw as StartupConfig["stellarNetwork"])
    : undefined;
  if (!stellarNetwork) {
    errors.push(
      `STELLAR_NETWORK '${env.STELLAR_NETWORK}' is invalid. Allowed values: testnet, mainnet.`,
    );
  }

  const horizonUrlRaw = (env.STELLAR_HORIZON_URL || "").trim();
  if (!horizonUrlRaw) {
    errors.push(
      "STELLAR_HORIZON_URL is required and must be a valid http(s) URL.",
    );
  }

  let horizonUrl: URL | undefined;
  if (horizonUrlRaw) {
    try {
      horizonUrl = new URL(horizonUrlRaw);
      if (horizonUrl.protocol !== "http:" && horizonUrl.protocol !== "https:") {
        errors.push(
          `STELLAR_HORIZON_URL '${horizonUrlRaw}' must use http or https.`,
        );
      }
    } catch {
      errors.push(`STELLAR_HORIZON_URL '${horizonUrlRaw}' is not a valid URL.`);
    }
  }

  const contractAddress = (
    env.CONTRACT_ADDRESS ||
    env.STELLAR_CONTRACT_ADDRESS ||
    ""
  ).trim();
  if (!contractAddress) {
    errors.push(
      "Set CONTRACT_ADDRESS or STELLAR_CONTRACT_ADDRESS to a deployed contract address.",
    );
  } else if (!STELLAR_CONTRACT_REGEX.test(contractAddress)) {
    errors.push(
      "Contract address format is invalid. Expected a Soroban contract strkey starting with C.",
    );
  }

  if (
    env.CONTRACT_ADDRESS &&
    env.STELLAR_CONTRACT_ADDRESS &&
    env.CONTRACT_ADDRESS.trim() !== env.STELLAR_CONTRACT_ADDRESS.trim()
  ) {
    errors.push(
      "CONTRACT_ADDRESS and STELLAR_CONTRACT_ADDRESS are both set but do not match.",
    );
  }

  const signerSecret = (
    env.STELLAR_REBALANCE_SECRET ||
    env.STELLAR_SECRET_KEY ||
    ""
  ).trim();
  if (!featureFlags.demoMode || !featureFlags.allowDemoBalanceFallback) {
    if (!signerSecret) {
      errors.push(
        "Set STELLAR_REBALANCE_SECRET (or STELLAR_SECRET_KEY) for signed DEX rebalance execution.",
      );
    } else if (!STELLAR_SECRET_REGEX.test(signerSecret)) {
      errors.push(
        "STELLAR_REBALANCE_SECRET format is invalid. Expected a Stellar secret starting with S.",
      );
    }
  } else if (signerSecret && !STELLAR_SECRET_REGEX.test(signerSecret)) {
    errors.push(
      "STELLAR_REBALANCE_SECRET format is invalid. Expected a Stellar secret starting with S.",
    );
  }

  const jwtSecretRaw = (env.JWT_SECRET || "").trim();
  if (jwtSecretRaw && jwtSecretRaw.length < 32) {
    errors.push(
      `JWT_SECRET is set but only ${jwtSecretRaw.length} characters — must be at least 32.`,
    );
  }
  const jwtAuthEnabled = jwtSecretRaw.length >= 32;

  if (stellarNetwork && horizonUrl) {
    const host = horizonUrl.hostname.toLowerCase();
    const isTestnetHost = host.includes("testnet");
    if (stellarNetwork === "testnet" && !isTestnetHost) {
      warnings.push(
        "STELLAR_NETWORK is testnet but STELLAR_HORIZON_URL does not look like a testnet endpoint.",
      );
    }
    if (stellarNetwork === "mainnet" && isTestnetHost) {
      errors.push(
        "STELLAR_NETWORK is mainnet but STELLAR_HORIZON_URL points to a testnet host.",
      );
    }
  }

  const corsOrigins = (env.CORS_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const metricsAllowlist = (env.METRICS_ALLOWLIST || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const readinessCacheTtlMsRaw = (env.READINESS_CACHE_TTL_MS || "2000").trim();
  const readinessCacheTtlMs = Number.parseInt(readinessCacheTtlMsRaw, 10);
  if (!Number.isInteger(readinessCacheTtlMs) || readinessCacheTtlMs < 0) {
    errors.push(
      `READINESS_CACHE_TTL_MS '${env.READINESS_CACHE_TTL_MS}' is invalid. Provide a non-negative integer.`,
    );
  }

  const consentAuditRetentionDaysRaw = (env.CONSENT_AUDIT_RETENTION_DAYS || "365").trim();
  const consentAuditRetentionDays = Number.parseInt(consentAuditRetentionDaysRaw, 10);
  if (!Number.isInteger(consentAuditRetentionDays) || consentAuditRetentionDays < 1) {
    errors.push(
      `CONSENT_AUDIT_RETENTION_DAYS '${env.CONSENT_AUDIT_RETENTION_DAYS}' is invalid. Provide a positive integer.`,
    );
  }

  const queueStartupRetriesRaw = (env.QUEUE_STARTUP_RETRIES || "5").trim();
  const queueStartupRetries = Number.parseInt(queueStartupRetriesRaw, 10);
  if (!Number.isInteger(queueStartupRetries) || queueStartupRetries < 1) {
    errors.push(
      `QUEUE_STARTUP_RETRIES '${env.QUEUE_STARTUP_RETRIES}' is invalid. Provide a positive integer.`,
    );
  }

  const queueStartupInitialDelayRaw = (env.QUEUE_STARTUP_INITIAL_DELAY_MS || "1000").trim();
  const queueStartupInitialDelayMs = Number.parseInt(queueStartupInitialDelayRaw, 10);
  if (!Number.isInteger(queueStartupInitialDelayMs) || queueStartupInitialDelayMs < 0) {
    errors.push(
      `QUEUE_STARTUP_INITIAL_DELAY_MS '${env.QUEUE_STARTUP_INITIAL_DELAY_MS}' is invalid. Provide a non-negative integer.`,
    );
  }

  const queueStartupMaxDelayRaw = (env.QUEUE_STARTUP_MAX_DELAY_MS || "10000").trim();
  const queueStartupMaxDelayMs = Number.parseInt(queueStartupMaxDelayRaw, 10);
  if (!Number.isInteger(queueStartupMaxDelayMs) || queueStartupMaxDelayMs < 0) {
    errors.push(
      `QUEUE_STARTUP_MAX_DELAY_MS '${env.QUEUE_STARTUP_MAX_DELAY_MS}' is invalid. Provide a non-negative integer.`,
    );
  }

  const autoRebalancerEnabled =
    env.NODE_ENV === "production" || env.ENABLE_AUTO_REBALANCER === "true";

  // Cache tuning configuration
  const cacheDurationMsRaw = (env.CACHE_DURATION_MS || "").trim();
  let cacheDurationMs = nodeEnv === "production" ? 600000 : 300000; // 10 min vs 5 min default
  if (cacheDurationMsRaw) {
    const parsed = Number.parseInt(cacheDurationMsRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1000) {
      errors.push(
        `CACHE_DURATION_MS '${cacheDurationMsRaw}' must be an integer >= 1000 (1 second minimum).`,
      );
    } else {
      cacheDurationMs = parsed;
    }
  }

  const priceDataMaxAgeSecondsRaw = (env.PRICE_DATA_MAX_AGE || "").trim();
  let priceDataMaxAgeSeconds = 600; // 10 minutes default
  if (priceDataMaxAgeSecondsRaw) {
    const parsed = Number.parseInt(priceDataMaxAgeSecondsRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 60) {
      errors.push(
        `PRICE_DATA_MAX_AGE '${priceDataMaxAgeSecondsRaw}' must be an integer >= 60.`,
      );
    } else {
      priceDataMaxAgeSeconds = parsed;
    }
  }

  const minRequestIntervalMsRaw = (env.MIN_REQUEST_INTERVAL_MS || "").trim();
  let minRequestIntervalMs = 90000; // 1.5 minutes default
  if (minRequestIntervalMsRaw) {
    const parsed = Number.parseInt(minRequestIntervalMsRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1000) {
      errors.push(
        `MIN_REQUEST_INTERVAL_MS '${minRequestIntervalMsRaw}' must be an integer >= 1000.`,
      );
    } else {
      minRequestIntervalMs = parsed;
    }
  }

  if (errors.length > 0) {
    const numberedErrors = errors
      .map((msg, idx) => `${idx + 1}. ${msg}`)
      .join("\n");
    throw new Error(
      [
        "[STARTUP-CONFIG] Validation failed. Server will not start.",
        numberedErrors,
        "Fix the values in backend/.env and restart the server.",
      ].join("\n"),
    );
  }

  if (warnings.length > 0) {
    const numberedWarnings = warnings
      .map((msg, idx) => `${idx + 1}. ${msg}`)
      .join("\n");
    logger.warn("[STARTUP-CONFIG] Warnings", { warnings });
  }

  const featureFlagsFile = env.FEATURE_FLAGS_FILE ? env.FEATURE_FLAGS_FILE.trim() : undefined;

  return {
    nodeEnv: nodeEnv || "development",
    port: Number.isInteger(port) ? port : 3001,
    stellarNetwork: stellarNetwork || "testnet",
    stellarHorizonUrl: horizonUrlRaw,
    stellarContractAddress: contractAddress,
    autoRebalancerEnabled,
    corsOrigins,
    metricsAllowlist,
    readinessCacheTtlMs: Number.isInteger(readinessCacheTtlMs) ? readinessCacheTtlMs : 2000,
    consentAuditRetentionDays: Number.isInteger(consentAuditRetentionDays) ? consentAuditRetentionDays : 365,
    queueStartupRetries: Number.isInteger(queueStartupRetries) ? queueStartupRetries : 5,
    queueStartupInitialDelayMs: Number.isInteger(queueStartupInitialDelayMs) ? queueStartupInitialDelayMs : 1000,
    queueStartupMaxDelayMs: Number.isInteger(queueStartupMaxDelayMs) ? queueStartupMaxDelayMs : 10000,
    hasRebalanceSigner: !!signerSecret,
    jwtAuthEnabled,
    featureFlags,
    cacheDurationMs,
    priceDataMaxAgeSeconds,
    minRequestIntervalMs,
    featureFlagsFile,
  };
}

export function buildStartupSummary(
  config: StartupConfig,
  redisAvailable?: boolean,
): Record<string, unknown> {
  const queueEnabled = redisAvailable === true;
  return {
    nodeEnv: config.nodeEnv,
    port: config.port,
    stellarNetwork: config.stellarNetwork,
    horizonHost: safeUrlHost(config.stellarHorizonUrl),
    contractAddress: maskValue(config.stellarContractAddress, 6, 4),
    autoRebalancerEnabled: config.autoRebalancerEnabled,
    rebalanceSignerConfigured: config.hasRebalanceSigner,
    corsOriginsConfigured: config.corsOrigins.length,
    cache: {
      durationMs: config.cacheDurationMs,
      priceDataMaxAgeSeconds: config.priceDataMaxAgeSeconds,
      minRequestIntervalMs: config.minRequestIntervalMs,
    },
    redis: {
      available: redisAvailable ?? null,
      rateLimitStore: queueEnabled ? "redis" : "memory",
    },
    queueSubsystem: {
      enabled: queueEnabled,
      activeWorkers: queueEnabled
        ? ["portfolio-check", "rebalance", "analytics-snapshot", "analytics-compaction"]
        : [],
      disabledReason: !queueEnabled
        ? "Redis unreachable — set REDIS_URL to enable BullMQ workers"
        : undefined,
      startupRetries: config.queueStartupRetries,
      startupInitialDelayMs: config.queueStartupInitialDelayMs,
      startupMaxDelayMs: config.queueStartupMaxDelayMs,
    },
    jwtAuthEnabled: config.jwtAuthEnabled,
    readinessCacheTtlMs: config.readinessCacheTtlMs,
    consentAuditRetentionDays: config.consentAuditRetentionDays,
    featureFlags: {
      demoMode: config.featureFlags.demoMode,
      allowFallbackPrices: config.featureFlags.allowFallbackPrices,
      enableDebugRoutes: config.featureFlags.enableDebugRoutes,
      allowMockPriceHistory: config.featureFlags.allowMockPriceHistory,
      allowDemoBalanceFallback: config.featureFlags.allowDemoBalanceFallback,
      enableDemoDbSeed: config.featureFlags.enableDemoDbSeed,
      overrideFile: config.featureFlagsFile || null,
    },
  };
}

export function logStartupSubsystems(
  config: StartupConfig,
  redisAvailable: boolean,
  rateLimitStore: "redis" | "memory",
): void {
  logger.info("[STARTUP] Subsystem status", {
    required: {
      database: "enabled",
      stellarNetwork: config.stellarNetwork,
      horizonUrl: safeUrlHost(config.stellarHorizonUrl),
      contractAddress: maskValue(config.stellarContractAddress, 6, 4),
      rebalanceSigner: config.hasRebalanceSigner ? "configured" : "missing",
    },
    optional: {
      redis: redisAvailable ? "connected" : "unavailable — set REDIS_URL",
      rateLimitStore: `${rateLimitStore} store`,
      queueWorkers: redisAvailable
        ? "enabled (portfolio-check, rebalance, analytics-snapshot, analytics-compaction)"
        : "disabled — no Redis",
      queueScheduler: redisAvailable ? "enabled" : "disabled — no Redis",
      autoRebalancer: config.autoRebalancerEnabled
        ? "enabled"
        : "disabled (non-production)",
    },
    featureFlags: {
      demoMode: config.featureFlags.demoMode,
      debugRoutes: config.featureFlags.enableDebugRoutes,
      overrideFile: config.featureFlagsFile || "none",
    },
  });

  if (!redisAvailable) {
    logger.warn(
      "[STARTUP] Redis unreachable — BullMQ workers, scheduled jobs, and distributed rate limiting are inactive. " +
        "In-memory rate limiting is active as a single-instance fallback. " +
        "Set REDIS_URL (default: redis://localhost:6379) and restart to enable the full queue subsystem.",
    );
  }
}

function safeUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<invalid-url>";
  }
}

function maskValue(value: string, head: number, tail: number): string {
  if (!value || value.length <= head + tail) return "<hidden>";
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}
