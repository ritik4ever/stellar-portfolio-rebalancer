import { Router, Request, Response } from 'express'
import { StellarService } from '../services/stellar.js'
import { ReflectorService } from '../services/reflector.js'
import { riskManagementService, rebalanceHistoryService } from '../services/serviceContainer.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { CircuitBreakers } from '../services/circuitBreakers.js'
import { analyticsService } from '../services/analyticsService.js'
import { notificationService } from '../services/notificationService.js'
import { contractEventIndexerService } from '../services/contractEventIndexer.js'
import { AutoRebalancerService } from '../services/autoRebalancer.js'
import { logger, logAudit } from '../utils/logger.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { requireAdmin } from '../middleware/auth.js'
import { requireJwt, requireJwtWhenEnabled } from '../middleware/requireJwt.js'
import { getAuthConfig } from '../services/authService.js'
import { writeRateLimiter, protectedWriteLimiter, protectedCriticalLimiter, adminRateLimiter } from '../middleware/rateLimit.js'
import { blockDebugInProduction } from '../middleware/debugGate.js'
import { getFeatureFlags, getPublicFeatureFlags } from '../config/featureFlags.js'
import { getQueueMetrics } from '../queue/queueMetrics.js'
import { getPortfolioCheckWorkerStatus } from '../queue/workers/portfolioCheckWorker.js'
import { getRebalanceWorkerStatus } from '../queue/workers/rebalanceWorker.js'
import { getAnalyticsSnapshotWorkerStatus } from '../queue/workers/analyticsSnapshotWorker.js'
import { getErrorMessage, getErrorObject, parseOptionalBoolean } from '../utils/helpers.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import {
    createPortfolioSchema,
    recordConsentSchema,
    consentStatusQuerySchema,
    notificationSubscribeSchema,
    notificationQuerySchema,
    adminAddAssetSchema,
    adminPatchAssetSchema,
    portfolioExportQuerySchema,
    rebalanceHistoryQuerySchema,
    debugTestNotificationSchema
} from './validation.js'
import { rebalanceLockService } from '../services/rebalanceLock.js'
import { REBALANCE_STRATEGIES } from '../services/rebalancingStrategyService.js'
import type { Portfolio } from '../types/index.js'
import { ok, fail } from '../utils/apiResponse.js'
import { getPortfolioExport } from '../services/portfolioExportService.js'
import { assetRegistryService } from '../services/assetRegistryService.js'
import {
  riskManagementService,
  rebalanceHistoryService,
} from "../services/serviceContainer.js";
import { portfolioStorage } from "../services/portfolioStorage.js";
import { CircuitBreakers } from "../services/circuitBreakers.js";
import { analyticsService } from "../services/analyticsService.js";
import { notificationService } from "../services/notificationService.js";
import { contractEventIndexerService } from "../services/contractEventIndexer.js";
import { AutoRebalancerService } from "../services/autoRebalancer.js";
import { logger, logAudit } from "../utils/logger.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { requireAdmin } from "../middleware/auth.js";
import { requireJwt, requireJwtWhenEnabled } from "../middleware/requireJwt.js";
import { getAuthConfig } from "../services/authService.js";
import {
  writeRateLimiter,
  protectedWriteLimiter,
  protectedCriticalLimiter,
  adminRateLimiter,
} from "../middleware/rateLimit.js";
import { blockDebugInProduction } from "../middleware/debugGate.js";
import {
  getFeatureFlags,
  getPublicFeatureFlags,
} from "../config/featureFlags.js";
import { getQueueMetrics } from "../queue/queueMetrics.js";
import {
  getErrorMessage,
  getErrorObject,
  parseOptionalBoolean,
} from "../utils/helpers.js";
import { createPortfolioSchema } from "./validation.js";
import { rebalanceLockService } from "../services/rebalanceLock.js";
import { REBALANCE_STRATEGIES } from "../services/rebalancingStrategyService.js";
import type { Portfolio } from "../types/index.js";
import { ok, fail } from "../utils/apiResponse.js";
import { getPortfolioExport } from "../services/portfolioExportService.js";
import { assetRegistryService } from "../services/assetRegistryService.js";
import {
  AssetRegistryConflictError,
  AssetRegistryValidationError,
} from "../services/assetRegistryValidation.js";
import { rateLimitMonitor } from "../services/rateLimitMonitor.js";
import { databaseService } from "../services/databaseService.js";
import { autoRebalancer } from "../services/runtimeServices.js";

const router = Router();
const stellarService = new StellarService();
const reflectorService = new ReflectorService();
const featureFlags = getFeatureFlags();
const publicFeatureFlags = getPublicFeatureFlags();

const parseOptionalTimestamp = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return undefined;
  return ts.toISOString();
};

const parseHistorySource = (
  value: unknown,
): "offchain" | "simulated" | "onchain" | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "offchain") return "offchain";
  if (normalized === "simulated") return "simulated";
  if (normalized === "onchain") return "onchain";
  return undefined;
};

/** Lightweight JSON health for API clients and integration tests (mounted at /api/health). */
router.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

router.get("/strategies", (_req: Request, res: Response) => {
  return ok(res, { strategies: REBALANCE_STRATEGIES });
});

// ─── Legal consent (GDPR/CCPA) ─────────────────────────────────────────────
/** Get consent status for a user. Required before using the app. */
router.get('/consent/status', validateQuery(consentStatusQuerySchema), (req: Request, res: Response) => {
    try {
        const userId = (req.query.userId ?? req.query.user_id) as string
        const consent = databaseService.getConsent(userId)
        const accepted = databaseService.hasFullConsent(userId)
        return ok(res, {
            accepted,
            termsAcceptedAt: consent?.termsAcceptedAt ?? null,
            privacyAcceptedAt: consent?.privacyAcceptedAt ?? null,
            cookieAcceptedAt: consent?.cookieAcceptedAt ?? null
        })
    } catch (error) {
        logger.error('[ERROR] Consent status failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Record user acceptance of ToS, Privacy Policy, Cookie Policy. */
router.post('/consent', ...protectedWriteLimiter, idempotencyMiddleware, validateRequest(recordConsentSchema), (req: Request, res: Response) => {
    try {
        const { userId, terms, privacy, cookies } = req.body
        const ipAddress = req.ip ?? req.socket?.remoteAddress
        const userAgent = req.get('user-agent')
        databaseService.recordConsent(userId, { terms, privacy, cookies, ipAddress, userAgent })
        return ok(res, { message: 'Consent recorded', accepted: true })
    } catch (error) {
      logger.error("[ERROR] Record consent failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

/** GDPR: Delete all data for a user (portfolios, history, consent). Requires JWT when enabled. */
router.delete(
  "/user/:address/data",
  requireJwtWhenEnabled,
  ...protectedCriticalLimiter,
  async (req: Request, res: Response) => {
    try {
      const address = req.params.address;
      const userId = req.user?.address ?? address;
      if (userId !== address)
        return fail(res, 403, "FORBIDDEN", "You can only delete your own data");
      if (!address)
        return fail(res, 400, "VALIDATION_ERROR", "address is required");
      try {
        const { deleteAllRefreshTokensForUser } =
          await import("../db/refreshTokenDb.js");
        if (typeof deleteAllRefreshTokensForUser === "function") {
          await deleteAllRefreshTokensForUser(userId);
        }
      } catch (_) {
        /* refresh token DB optional */
      }
      databaseService.deleteUserData(userId);
      return ok(res, { message: "Your data has been deleted" });
    } catch (error) {
      logger.error("[ERROR] Delete user data failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// ─── Asset registry (configurable assets, no contract redeploy) ─────────────────
/** Public: list enabled assets for portfolio setup and frontend */
router.get("/assets", (_req: Request, res: Response) => {
  try {
    const enabledOnly = parseOptionalBoolean(_req.query.enabledOnly) !== false;
    const assets = assetRegistryService.list(enabledOnly);
    return ok(res, { assets });
  } catch (error) {
    logger.error("[ERROR] List assets failed", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

/** Admin: list all assets (including disabled) */
router.get("/admin/assets", requireAdmin, (_req: Request, res: Response) => {
  try {
    const assets = assetRegistryService.list(false);
    return ok(res, { assets });
  } catch (error) {
    logger.error("[ERROR] Admin list assets failed", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

/** Admin: get rate limiting metrics and monitoring data */
router.get(
  "/admin/rate-limits/metrics",
  requireAdmin,
  (_req: Request, res: Response) => {
    try {
      const metrics = rateLimitMonitor.getMetrics();
      const topOffendersByIP = rateLimitMonitor.getTopOffendersByIP(10);
      const topOffendersByUser = rateLimitMonitor.getTopOffendersByUser(10);
      const throttlingByEndpoint = rateLimitMonitor.getThrottlingByEndpoint();

      return ok(res, {
        metrics,
        topOffendersByIP,
        topOffendersByUser,
        throttlingByEndpoint,
        report: rateLimitMonitor.generateReport(),
      });
    } catch (error) {
      logger.error("[ERROR] Admin rate limit metrics failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

/** Admin: add asset */
router.post(
  "/admin/assets",
  requireAdmin,
  adminRateLimiter,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { symbol, name, contractAddress, issuerAccount, coingeckoId } =
        req.body ?? {};
      assetRegistryService.add(symbol, name, {
        contractAddress,
        issuerAccount,
        coingeckoId,
      });
      const parsedSymbol =
        typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
      const asset = assetRegistryService.getBySymbol(parsedSymbol);
      if (asset) {
        const auditFields: Record<string, unknown> = {
          domain: "asset_registry",
          actorPublicKey: req.adminPublicKey,
          symbol: asset.symbol,
          name: asset.name,
          enabled: asset.enabled,
        };
        if (asset.coingeckoId) auditFields.coingeckoId = asset.coingeckoId;
        if (asset.contractAddress)
          auditFields.contractAddress = asset.contractAddress;
        if (asset.issuerAccount)
          auditFields.issuerAccount = asset.issuerAccount;
        logAudit("asset_registry_asset_created", auditFields);
      }
      return ok(res, { asset }, { status: 201 });
    } catch (error) {
      if (error instanceof AssetRegistryValidationError) {
        return fail(res, 400, "VALIDATION_ERROR", error.message);
      }
      if (error instanceof AssetRegistryConflictError) {
        return fail(res, 409, "ASSET_CONFLICT", error.message);
      }
      logger.error("[ERROR] Admin add asset failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

/** Admin: remove asset */
router.delete(
  "/admin/assets/:symbol",
  requireAdmin,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol;
      if (!symbol)
        return fail(res, 400, "VALIDATION_ERROR", "symbol is required");
      const prior = assetRegistryService.getBySymbol(symbol);
      const removed = assetRegistryService.remove(symbol);
      if (!removed) return fail(res, 404, "NOT_FOUND", "Asset not found");
      if (prior) {
        const auditFields: Record<string, unknown> = {
          domain: "asset_registry",
          actorPublicKey: req.adminPublicKey,
          symbol: prior.symbol,
          name: prior.name,
          enabled: prior.enabled,
        };
        if (prior.coingeckoId) auditFields.coingeckoId = prior.coingeckoId;
        if (prior.contractAddress)
          auditFields.contractAddress = prior.contractAddress;
        if (prior.issuerAccount)
          auditFields.issuerAccount = prior.issuerAccount;
        logAudit("asset_registry_asset_removed", auditFields);
      }
      return ok(res, { message: "Asset removed" });
    } catch (error) {
      logger.error("[ERROR] Admin remove asset failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

/** Admin: enable/disable asset */
router.patch(
  "/admin/assets/:symbol",
  requireAdmin,
  adminRateLimiter,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol;
      const enabled = req.body?.enabled;
      if (!symbol)
        return fail(res, 400, "VALIDATION_ERROR", "symbol is required");
      if (typeof enabled !== "boolean")
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "body.enabled must be boolean",
        );
      const prior = assetRegistryService.getBySymbol(symbol);
      const updated = assetRegistryService.setEnabled(symbol, enabled);
      if (!updated) return fail(res, 404, "NOT_FOUND", "Asset not found");
      const asset = assetRegistryService.getBySymbol(symbol);
      if (prior) {
        logAudit("asset_registry_asset_updated", {
          domain: "asset_registry",
          actorPublicKey: req.adminPublicKey,
          symbol: prior.symbol,
          field: "enabled",
          previousValue: prior.enabled,
          newValue: enabled,
        });
      }
      return ok(res, { asset });
    } catch (error) {
      logger.error("[ERROR] Admin set asset enabled failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
})

router.get('/rebalance/history', validateQuery(rebalanceHistoryQuerySchema), async (req: Request, res: Response) => {
    try {
        const portfolioId = req.query.portfolioId as string | undefined
        const limit = (req.query.limit as unknown as number | undefined) ?? 50
        const source = parseHistorySource(req.query.source)
        const startTimestamp = parseOptionalTimestamp(req.query.startTimestamp)
        const endTimestamp = parseOptionalTimestamp(req.query.endTimestamp)
        const syncOnChain = (req.query.syncOnChain as unknown as boolean | undefined) === true

        logger.info('Rebalance history request', { portfolioId: portfolioId || 'all' })
        if (syncOnChain) {
            await contractEventIndexerService.syncOnce()
        }

        const history = await rebalanceHistoryService.getRebalanceHistory(
            portfolioId || undefined,
            limit,
            {
                eventSource: source,
                startTimestamp,
                endTimestamp
            }
        )

        return ok(
            res,
            {
                history,
                portfolioId: portfolioId || undefined,
                filters: {
                    source,
                    startTimestamp,
                    endTimestamp
                }
            },
            { meta: { count: history.length } }
        )

    } catch (error) {
        logger.error('[ERROR] Rebalance history failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }

    const history = await rebalanceHistoryService.getRebalanceHistory(
      portfolioId || undefined,
      limit,
      {
        eventSource: source,
        startTimestamp,
        endTimestamp,
      },
    );

    return ok(
      res,
      {
        history,
        portfolioId: portfolioId || undefined,
        filters: {
          source,
          startTimestamp,
          endTimestamp,
        },
      },
      { meta: { count: history.length } },
    );
  } catch (error) {
    logger.error("[ERROR] Rebalance history failed", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

// Record new rebalance event
router.post(
  "/rebalance/history",
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const eventData = req.body;

      logger.info("Recording new rebalance event", { eventData });

      const event = await rebalanceHistoryService.recordRebalanceEvent({
        ...eventData,
        isAutomatic: eventData.isAutomatic || false,
      });

      return ok(res, { event });
    } catch (error) {
      logger.error("[ERROR] Failed to record rebalance event", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.post(
  "/rebalance/history/sync-onchain",
  requireAdmin,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    try {
      const result = await contractEventIndexerService.syncOnce();
      return ok(res, {
        ...result,
        indexer: contractEventIndexerService.getStatus(),
      });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.post(
  "/portfolio",
  ...protectedWriteLimiter,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const parsed = createPortfolioSchema.safeParse(req.body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const message = first?.message ?? "Validation failed";
        const fullMessage = parsed.error.issues.some(
          (e) => e.path.join(".") !== "",
        )
          ? message
          : req.body?.userAddress == null
            ? "Missing required fields: userAddress, allocations, threshold"
            : req.body?.allocations == null
              ? "Missing required fields: allocations, threshold"
              : req.body?.threshold == null
                ? "Missing required fields: threshold"
                : message;
        return fail(res, 400, "VALIDATION_ERROR", fullMessage);
      }
      const {
        userAddress,
        allocations,
        threshold,
        slippageTolerance,
        strategy,
        strategyConfig,
      } = parsed.data;

      const slippageTolerancePercent = slippageTolerance ?? 1;
      const portfolioId = await stellarService.createPortfolio(
        userAddress,
        allocations,
        threshold,
        slippageTolerancePercent,
        strategy ?? "threshold",
        strategyConfig ?? {},
      );
      const mode = featureFlags.demoMode ? "demo" : "onchain";
      return ok(
        res,
        {
          portfolioId,
          status: "created",
          mode,
        },
        { status: 201 },
      );
    } catch (error) {
      logger.error("[ERROR] Create portfolio failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.get("/portfolio/:id", async (req: Request, res: Response) => {
  try {
    const portfolioId = req.params.id;
    if (!portfolioId)
      return fail(res, 400, "VALIDATION_ERROR", "Portfolio ID required");
    const portfolio = await stellarService.getPortfolio(portfolioId);
    if (!portfolio) return fail(res, 404, "NOT_FOUND", "Portfolio not found");

    return ok(res, { portfolio });
  } catch (error) {
    logger.error("[ERROR] Get portfolio failed", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

// Portfolio export (JSON, CSV, PDF) — GDPR data portability
router.get(
  "/portfolio/:id/export",
  requireJwtWhenEnabled,
  async (req: Request, res: Response) => {
    try {
      const portfolioId = req.params.id;
      const format = (req.query.format as string)?.toLowerCase();
      if (!portfolioId)
        return fail(res, 400, "VALIDATION_ERROR", "Portfolio ID required");
      if (!["json", "csv", "pdf"].includes(format)) {
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "Query parameter format must be one of: json, csv, pdf",
        );
      }
      const portfolio = await portfolioStorage.getPortfolio(portfolioId);
      if (!portfolio) return fail(res, 404, "NOT_FOUND", "Portfolio not found");
      if (req.user && portfolio.userAddress !== req.user.address) {
        return fail(
          res,
          403,
          "FORBIDDEN",
          "You can only export your own portfolio",
        );
      }
      const result = await getPortfolioExport(
        portfolioId,
        format as "json" | "csv" | "pdf",
      );
      if (!result) return fail(res, 404, "NOT_FOUND", "Portfolio not found");
      res.setHeader("Content-Type", result.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      );
      if (Buffer.isBuffer(result.body)) {
        return res.send(result.body);
      }
      return res.send(result.body);
    } catch (error) {
      logger.error("[ERROR] Portfolio export failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.get("/user/:address/portfolios", async (req: Request, res: Response) => {
  try {
    const address = req.params.address;
    if (!address)
      return fail(res, 400, "VALIDATION_ERROR", "User address required");
    const authConfig = getAuthConfig();
    const allowPublicInDemo =
      authConfig.enabled &&
      featureFlags.demoMode &&
      featureFlags.allowPublicUserPortfoliosInDemo;

    // Privacy model:
    // - When JWT auth is enabled, only the token subject may list portfolios for `:address`.
    // - In demo mode, we can explicitly allow unauthenticated public listing via feature flag.
    if (authConfig.enabled && !allowPublicInDemo) {
      let nextCalled = false;
      requireJwt(req, res, () => {
        nextCalled = true;
      });
      if (!nextCalled) return;

      if (req.user?.address !== address) {
        return fail(
          res,
          403,
          "FORBIDDEN",
          "You can only view your own portfolios",
        );
      }
    }

    const list = await portfolioStorage.getUserPortfolios(address);

    return ok(res, { portfolios: list });
  } catch (error) {
    logger.error("[ERROR] Get user portfolios failed", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

router.get(
  "/portfolio/:id/rebalance-plan",
  async (req: Request, res: Response) => {
    try {
      const portfolioId = req.params.id;
      if (!portfolioId)
        return fail(res, 400, "VALIDATION_ERROR", "Portfolio ID required");
      const portfolio = (await portfolioStorage.getPortfolio(portfolioId)) as
        | Portfolio
        | undefined;
      if (!portfolio) return fail(res, 404, "NOT_FOUND", "Portfolio not found");
      const prices = await reflectorService.getCurrentPrices();
      const totalValue = Object.entries(portfolio.balances || {}).reduce(
        (sum, [asset, bal]) => sum + bal * (prices[asset]?.price ?? 0),
        0,
      );
      const slippageTolerancePercent = portfolio.slippageTolerancePercent ?? 1;
      const estimatedSlippageBps = Math.round(slippageTolerancePercent * 100);
      return ok(res, {
        portfolioId,
        totalValue,
        maxSlippagePercent: slippageTolerancePercent,
        estimatedSlippageBps,
        prices: Object.keys(prices).length > 0 ? prices : undefined,
      });
    } catch (error) {
      logger.error("[ERROR] Rebalance plan failed", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.get(
  "/portfolio/:id/rebalance-estimate",
  async (req: Request, res: Response) => {
    try {
      const portfolioId = req.params.id;
      if (!portfolioId)
        return fail(res, 400, "VALIDATION_ERROR", "Portfolio ID required");
      const estimate = await stellarService.estimateRebalanceGas(portfolioId);

      return ok(res, estimate);
    } catch (error) {
      logger.error("[ERROR] Rebalance estimate failed", {
        error: getErrorObject(error),
        portfolioId: req.params.id,
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// Manual portfolio rebalance
router.post(
  "/portfolio/:id/rebalance",
  ...protectedCriticalLimiter,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const portfolioId = req.params.id;

      console.log(
        `[INFO] Attempting manual rebalance for portfolio: ${portfolioId}`,
      );

      // Try to acquire lock
      const lockAcquired = await rebalanceLockService.acquireLock(portfolioId);
      if (!lockAcquired) {
        console.log(
          `[WARNING] Rebalance already in progress for portfolio: ${portfolioId}`,
        );
        return fail(
          res,
          409,
          "CONFLICT",
          "Rebalance already in progress for this portfolio",
        );
      }

      try {
        const portfolio = await stellarService.getPortfolio(portfolioId);
        if (!portfolio) {
          return fail(res, 404, "NOT_FOUND", "Portfolio not found");
        }
        if (req.user && portfolio.userAddress !== req.user.address) {
          return fail(res, 403, "FORBIDDEN", "Portfolio not found");
        }
        const prices = await reflectorService.getCurrentPrices();
        const riskCheck = riskManagementService.shouldAllowRebalance(
          portfolio as unknown as Portfolio,
          prices,
        );

        if (!riskCheck.allowed) {
          return fail(
            res,
            400,
            "BAD_REQUEST",
            riskCheck.reason ?? "Rebalance blocked by risk checks",
            { alerts: riskCheck.alerts },
          );
        }

        const result = await stellarService.executeRebalance(portfolioId);

        return ok(res, { result });
      } finally {
        await rebalanceLockService.releaseLock(portfolioId);
      }
    } catch (error) {
      console.error("[ERROR] Manual rebalance failed:", error);
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// ================================
// RISK MANAGEMENT ROUTES
// ================================

// Get risk metrics for a portfolio
router.get(
  "/risk/metrics/:portfolioId",
  async (req: Request, res: Response) => {
    try {
      const { portfolioId } = req.params;

      logger.info("Calculating risk metrics for portfolio", { portfolioId });

      const portfolio = await stellarService.getPortfolio(portfolioId);
      const prices = await reflectorService.getCurrentPrices();

      // Calculate risk metrics with proper type conversion
      const allocationsRecord: Record<string, number> = {};
      if (Array.isArray(portfolio.allocations)) {
        portfolio.allocations.forEach((a: any) => {
          allocationsRecord[a.asset] = a.target;
        });
      } else {
        Object.assign(allocationsRecord, portfolio.allocations);
      }
      const riskMetrics = riskManagementService.analyzePortfolioRisk(
        allocationsRecord,
        prices,
      );
      const recommendations = riskManagementService.getRecommendations(
        riskMetrics,
        allocationsRecord,
      );
      const circuitBreakers = riskManagementService.getCircuitBreakerStatus();

      return ok(res, {
        portfolioId,
        riskMetrics,
        recommendations,
        circuitBreakers,
      });
    } catch (error) {
      logger.error("[ERROR] Failed to get risk metrics", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// Check if rebalancing should be allowed based on risk conditions
router.get("/risk/check/:portfolioId", async (req: Request, res: Response) => {
  try {
    const { portfolioId } = req.params;

    logger.info("Checking risk conditions for portfolio", { portfolioId });

    const portfolio = await stellarService.getPortfolio(portfolioId);
    const prices = await reflectorService.getCurrentPrices();

    const riskCheck = riskManagementService.shouldAllowRebalance(
      portfolio as unknown as Portfolio,
      prices,
    );

    return ok(res, {
      portfolioId,
      ...riskCheck,
    });
  } catch (error) {
    logger.error("[ERROR] Failed to check risk conditions", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

// ================================
// PRICE DATA ROUTES - FIXED FORMAT
// ================================

// Get current prices - FIXED to return direct format for frontend
router.get("/prices", async (req: Request, res: Response) => {
  try {
    logger.info("[DEBUG] Fetching prices for frontend...");
    const prices = await reflectorService.getCurrentPrices();

    logger.info("[DEBUG] Raw prices from service", { prices });

    // Return prices directly in the format frontend expects
    return ok(res, prices);
  } catch (error) {
    logger.error("[ERROR] Prices endpoint failed", {
      error: getErrorObject(error),
    });

    if (!featureFlags.allowFallbackPrices) {
      return fail(
        res,
        503,
        "SERVICE_UNAVAILABLE",
        "Price feeds unavailable and ALLOW_FALLBACK_PRICES is disabled",
      );
    }

    // Return explicit fallback data only when feature flag allows it.
    const fallbackPrices = {
      XLM: {
        price: 0.358878,
        change: -0.6,
        timestamp: Date.now() / 1000,
        source: "fallback",
      },
      BTC: {
        price: 111150,
        change: 0.23,
        timestamp: Date.now() / 1000,
        source: "fallback",
      },
      ETH: {
        price: 4384.56,
        change: -0.15,
        timestamp: Date.now() / 1000,
        source: "fallback",
      },
      USDC: {
        price: 0.999781,
        change: -0.002,
        timestamp: Date.now() / 1000,
        source: "fallback",
      },
    };

    logger.info("[DEBUG] Sending fallback prices", { fallbackPrices });
    return ok(res, fallbackPrices);
  }
});

// Enhanced prices endpoint with risk analysis
router.get("/prices/enhanced", async (req: Request, res: Response) => {
  try {
    logger.info("[INFO] Fetching enhanced prices with risk analysis");

    const prices = await reflectorService.getCurrentPrices();

    // Update risk management with latest prices and get alerts
    const riskAlerts = riskManagementService.updatePriceData(prices);

    // Add risk information to price data
    const enhancedPrices: Record<string, any> = {};

    Object.entries(prices).forEach(([asset, data]) => {
      // Type assertion to handle PriceData properly
      const priceData = data as any;

      enhancedPrices[asset] = {
        ...priceData,
        riskAlerts: riskAlerts.filter((alert: any) => alert.asset === asset),
        volatilityLevel:
          Math.abs(priceData.change || 0) > 10
            ? "high"
            : Math.abs(priceData.change || 0) > 5
              ? "medium"
              : "low",
      };
    });

    return ok(res, {
      prices: enhancedPrices,
      riskAlerts,
    });
  } catch (error) {
    logger.error("[ERROR] Failed to fetch enhanced prices", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

// Get detailed market data for specific asset
router.get("/market/:asset/details", async (req: Request, res: Response) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const reflector = new ReflectorService();
    const marketData = await reflector.getDetailedMarketData(asset);

    return ok(res, marketData);
  } catch (error) {
    logger.error("Failed to fetch detailed market data", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", "Failed to fetch market data");
  }
});

// Get price charts for frontend
router.get("/market/:asset/chart", async (req: Request, res: Response) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const days = parseInt(req.query.days as string) || 7;

    const reflector = new ReflectorService();
    const history = await reflector.getPriceHistory(asset, days);

    return ok(res, {
      asset,
      data: history,
      timeframe: `${days}d`,
      dataPoints: history.length,
    });
  } catch (error) {
    logger.error("Failed to fetch price chart", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", "Failed to fetch chart data");
  }
});

// ================================
// AUTO-REBALANCER ROUTES
// ================================

router.get("/auto-rebalancer/status", async (req: Request, res: Response) => {
  try {
    if (!autoRebalancer) {
      return fail(
        res,
        500,
        "INTERNAL_ERROR",
        "Auto-rebalancer not initialized",
        {
          status: { isRunning: false },
        },
      );
    }

    const status = autoRebalancer.getStatus();
    const statistics = await autoRebalancer.getStatistics();

    return ok(res, { status, statistics });
  } catch (error) {
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

router.post(
  "/auto-rebalancer/start",
  requireAdmin,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    try {
      if (!autoRebalancer) {
        return fail(
          res,
          500,
          "INTERNAL_ERROR",
          "Auto-rebalancer not initialized",
        );
      }

      await autoRebalancer.start();

      return ok(res, {
        message: "Auto-rebalancer started successfully",
        status: autoRebalancer.getStatus(),
      });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.post(
  "/auto-rebalancer/stop",
  requireAdmin,
  adminRateLimiter,
  (req: Request, res: Response) => {
    try {
      if (!autoRebalancer) {
        return fail(
          res,
          500,
          "INTERNAL_ERROR",
          "Auto-rebalancer not initialized",
        );
      }

      autoRebalancer.stop();

      return ok(res, {
        message: "Auto-rebalancer stopped successfully",
        status: autoRebalancer.getStatus(),
      });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.post(
  "/auto-rebalancer/force-check",
  requireAdmin,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    try {
      if (!autoRebalancer) {
        return fail(
          res,
          500,
          "INTERNAL_ERROR",
          "Auto-rebalancer not initialized",
        );
      }

      await autoRebalancer.forceCheck();

      return ok(res, { message: "Force check completed" });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.get(
  "/auto-rebalancer/history",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const portfolioId = req.query.portfolioId as string;
      const limit = parseInt(req.query.limit as string) || 50;

      let history;
      if (portfolioId) {
        history = await rebalanceHistoryService.getRecentAutoRebalances(
          portfolioId,
          limit,
        );
      } else {
        history = (
          await rebalanceHistoryService.getAllAutoRebalances(limit)
        ).slice(0, limit);
      }

      return ok(
        res,
        {
          history,
          portfolioId: portfolioId || "all",
        },
        { meta: { count: history.length } },
      );
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// ================================
// SYSTEM STATUS ROUTES
// ================================

// Get comprehensive system status
router.get("/system/status", async (req: Request, res: Response) => {
  try {
    const portfolioCount = await portfolioStorage.getPortfolioCount();
    const historyStats = await rebalanceHistoryService.getHistoryStats();
    const circuitBreakers = riskManagementService.getCircuitBreakerStatus();

    let priceSourcesHealthy = false;
    try {
      const prices = await reflectorService.getCurrentPrices();
      priceSourcesHealthy = Object.keys(prices).length > 0;
    } catch {
      priceSourcesHealthy = false;
    }

    const autoRebalancerStatus = autoRebalancer
      ? autoRebalancer.getStatus()
      : { isRunning: false };
    const autoRebalancerStats = autoRebalancer
      ? await autoRebalancer.getStatistics()
      : null;
    const onChainIndexerStatus = contractEventIndexerService.getStatus();
    const queueMetrics = await getQueueMetrics();

    return ok(res, {
      system: {
        status: priceSourcesHealthy ? "operational" : "degraded",
        uptime: global.process.uptime(),
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      },
      portfolios: {
        total: portfolioCount,
        active: portfolioCount,
      },
      rebalanceHistory: historyStats,
      riskManagement: {
        circuitBreakers,
        enabled: true,
        alertsActive: Object.values(circuitBreakers).some(
          (cb: any) => cb.isTriggered,
        ),
      },
      autoRebalancer: {
        status: autoRebalancerStatus,
        statistics: autoRebalancerStats,
        enabled: !!autoRebalancer,
      },
      onChainIndexer: onChainIndexerStatus,
      queue: {
        redisConnected: queueMetrics.redisConnected,
        schedulerEnabled: queueMetrics.redisConnected,
        activeWorkers: queueMetrics.redisConnected
          ? ["portfolio-check", "rebalance", "analytics-snapshot"]
          : [],
        disabledReason: queueMetrics.redisConnected
          ? undefined
          : "Redis unavailable — set REDIS_URL to enable BullMQ workers",
        metrics: queueMetrics.queues,
      },
      services: {
        priceFeeds: priceSourcesHealthy,
        riskManagement: true,
        webSockets: true,
        autoRebalancing: autoRebalancerStatus.isRunning,
        stellarNetwork: true,
        contractEventIndexer: onChainIndexerStatus.enabled,
        redis: queueMetrics.redisConnected,
        queueWorkers: queueMetrics.redisConnected,
      },
      featureFlags: publicFeatureFlags,
    });
  } catch (error) {
    logger.error("[ERROR] Failed to get system status", {
      error: getErrorObject(error),
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

// ================================
// PORTFOLIO CRUD AND REBALANCE
// ================================

router.post("/portfolio", async (req, res) => {
  try {
    const { userAddress, allocations, threshold, slippageTolerance } = req.body;
    if (!userAddress || !allocations || threshold === undefined) {
      return res
        .status(400)
        .json({
          error: "Missing required fields: userAddress, allocations, threshold",
        });
    }
    const total = Object.values(allocations as Record<string, number>).reduce(
      (sum: number, val: number) => sum + val,
      0,
    );
    if (Math.abs(total - 100) > 0.01) {
      return res.status(400).json({ error: "Allocations must sum to 100%" });
    }
    if (threshold < 1 || threshold > 50) {
      return res
        .status(400)
        .json({ error: "Threshold must be between 1 and 50" });
    }
    const stellarService = new StellarService();
    const portfolioId = await stellarService.createPortfolio(
      userAddress,
      allocations,
      threshold,
      slippageTolerance != null
        ? Math.max(0.5, Math.min(5, Number(slippageTolerance)))
        : 1,
    );
    const mode = process.env.DEMO_MODE === "true" ? "demo" : "live";
    res.status(201).json({ portfolioId, status: "created", mode });
  } catch (error) {
    logger.error("Failed to create portfolio", {
      error: getErrorObject(error),
    });
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.get("/portfolio/:id", async (req, res) => {
  try {
    const portfolioId = req.params.id;
    if (!portfolioId)
      return res.status(400).json({ error: "Portfolio ID required" });
    const stellarService = new StellarService();
    const portfolio = await stellarService.getPortfolio(portfolioId);
    if (!portfolio)
      return res.status(404).json({ error: "Portfolio not found" });
    res.json({ portfolio });
  } catch (error) {
    logger.error("Failed to fetch portfolio", {
      error: getErrorObject(error),
      portfolioId: req.params.id,
    });
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

router.post("/portfolio/:id/rebalance", async (req, res) => {
  try {
    const portfolioId = req.params.id;
    if (!portfolioId)
      return res.status(400).json({ error: "Portfolio ID required" });
    const stellarService = new StellarService();
    const result = await stellarService.executeRebalance(portfolioId);
    res.json({
      success: true,
      portfolioId,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Failed to execute rebalance", {
      error: getErrorObject(error),
      portfolioId: req.params.id,
    });
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// ================================
// ANALYTICS ROUTES
// ================================

router.get("/portfolio/:id/analytics", async (req: Request, res: Response) => {
  try {
    const portfolioId = req.params.id;
    const days = parseInt(req.query.days as string) || 30;

    if (!portfolioId) {
      return fail(res, 400, "VALIDATION_ERROR", "Portfolio ID required");
    }

    const portfolio = portfolioStorage.getPortfolio(portfolioId);
    if (!portfolio) {
      return fail(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    const analytics = analyticsService.getAnalytics(portfolioId, days);

    return ok(
      res,
      {
        portfolioId,
        data: analytics,
      },
      { meta: { count: analytics.length, period: `${days} days` } },
    );
  } catch (error) {
    logger.error("Failed to fetch analytics", {
      error: getErrorObject(error),
      portfolioId: req.params.id,
    });
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
  }
});

router.get(
  "/portfolio/:id/performance-summary",
  async (req: Request, res: Response) => {
    try {
      const portfolioId = req.params.id;

      if (!portfolioId) {
        return fail(res, 400, "VALIDATION_ERROR", "Portfolio ID required");
      }

      const portfolio = portfolioStorage.getPortfolio(portfolioId);
      if (!portfolio) {
        return fail(res, 404, "NOT_FOUND", "Portfolio not found");
      }

      const summary = analyticsService.getPerformanceSummary(portfolioId);

      return ok(res, { portfolioId, ...summary });
    } catch (error) {
      logger.error("Failed to fetch performance summary", {
        error: getErrorObject(error),
        portfolioId: req.params.id,
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// ================================
// NOTIFICATION ROUTES
// ================================

// Subscribe to notifications
router.post(
  "/notifications/subscribe",
  requireJwtWhenEnabled,
  ...protectedWriteLimiter,
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    try {
      // Issue #178: when auth is enabled, derive userId from the token only.
      // Reject requests that try to subscribe on behalf of a different address.
      let userId: string | undefined;
      if (getAuthConfig().enabled) {
        userId = req.user!.address;
        const bodyId = req.body?.userId as string | undefined;
        if (bodyId && bodyId !== userId) {
          return fail(res, 403, "FORBIDDEN", "Cannot manage notification preferences for another user");
        }
      } else {
        userId = req.body?.userId;
      }
      const { emailEnabled, webhookEnabled, webhookUrl, events, emailAddress } =
        req.body ?? {};

      // Validation
      if (!userId) {
        return fail(res, 400, "VALIDATION_ERROR", "userId is required");
      }

      if (
        emailEnabled === undefined ||
        webhookEnabled === undefined ||
        !events
      ) {
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "Missing required fields: emailEnabled, webhookEnabled, events",
        );
      }

      // Validate events object
      const requiredEvents = [
        "rebalance",
        "circuitBreaker",
        "priceMovement",
        "riskChange",
      ];
      for (const event of requiredEvents) {
        if (events[event] === undefined) {
          return fail(
            res,
            400,
            "VALIDATION_ERROR",
            `Missing event configuration: ${event}`,
          );
        }
      }

      // Validate email address if email is enabled
      if (emailEnabled && !emailAddress) {
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "email address is required when emailEnabled is true",
        );
      }

      // Validate webhook URL if webhook is enabled
      if (webhookEnabled && !webhookUrl) {
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "webhookUrl is required when webhookEnabled is true",
        );
      }

      if (webhookUrl && !webhookUrl.match(/^https?:\/\/.+/)) {
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "Invalid webhook URL format. Must start with http:// or https://",
        );
      }

      // Subscribe user
      notificationService.subscribe({
        userId,
        emailEnabled,
        emailAddress,
        webhookEnabled,
        webhookUrl,
        events,
      });

      logger.info("User subscribed to notifications", {
        userId,
        emailEnabled,
        webhookEnabled,
      });

      return ok(res, {
        message: "Notification preferences saved successfully",
      });
    } catch (error) {
      logger.error("Failed to subscribe to notifications", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// Get notification preferences
router.get(
  "/notifications/preferences",
  requireJwtWhenEnabled,
  async (req: Request, res: Response) => {
    try {
      // Issue #178: when auth is enabled, only allow reading own preferences.
      let userId: string | undefined;
      if (getAuthConfig().enabled) {
        userId = req.user!.address;
        const queryId = req.query.userId as string | undefined;
        if (queryId && queryId !== userId) {
          return fail(res, 403, "FORBIDDEN", "Cannot read notification preferences for another user");
        }
      } else {
        userId = req.query.userId as string | undefined;
      }

      if (!userId) {
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "userId query parameter is required",
        );
      }

      const preferences = notificationService.getPreferences(userId);

      if (!preferences) {
        return ok(res, {
          preferences: null,
          message: "No preferences found for this user",
        });
      }

      return ok(res, { preferences });
    } catch (error) {
      logger.error("Failed to get notification preferences", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// Unsubscribe from notifications
router.delete(
  "/notifications/unsubscribe",
  requireJwtWhenEnabled,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    try {
      // Issue #178: when auth is enabled, only allow unsubscribing own preferences.
      let userId: string | undefined;
      if (getAuthConfig().enabled) {
        userId = req.user!.address;
        const queryId = req.query.userId as string | undefined;
        if (queryId && queryId !== userId) {
          return fail(res, 403, "FORBIDDEN", "Cannot unsubscribe notification preferences for another user");
        }
      } else {
        userId = req.query.userId as string | undefined;
      }

      if (!userId) {
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "userId query parameter is required",
        );
      }

      notificationService.unsubscribe(userId);

      logger.info("User unsubscribed from notifications", { userId });

      return ok(res, {
        message: "Successfully unsubscribed from all notifications",
      });
    } catch (error) {
      logger.error("Failed to unsubscribe from notifications", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

// ================================
// DEBUG ROUTES
// ================================

// Get notification delivery logs
router.get('/notifications/logs', requireJwtWhenEnabled, validateQuery(notificationQuerySchema), async (req: Request, res: Response) => {
    try {
        let userId: string | undefined
        
        // Authorization Logic:
        // When global authentication is explicitly enabled, we extract the context directly from the token.
        // If the user tries passing an arbitrary ?userId=... query that does not match their own authenticated address, 
        // we forcefully block the request to prevent exposure of other users' delivery logs.
        // If authentication is disabled, we simply fall back to taking the userId query parameter as given.
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const queryId = req.query.userId as string | undefined
            if (queryId && queryId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot read notification logs for another user')
            }
        } else {
            userId = req.query.userId as string | undefined
        }

        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId query parameter is required')
        }

        const logs = notificationService.getLogs(userId)

        return ok(res, { logs })
    } catch (error) {
        logger.error('Failed to get notification logs', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})


/**
 * Debug-only + admin-gated endpoint for sending a single test notification.
 * This keeps test-notification behavior explicit and isolated from production routes.
 */
router.post(
  "/debug/notifications/test",
  blockDebugInProduction,
  requireAdmin,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    try {
      const userId = (req.body?.userId ?? req.user?.address) as
        | string
        | undefined;
      const eventType = req.body?.eventType as
        | "rebalance"
        | "circuitBreaker"
        | "priceMovement"
        | "riskChange"
        | undefined;
      const normalizedEventType = eventType ?? "rebalance";
      const allowedEvents = new Set([
        "rebalance",
        "circuitBreaker",
        "priceMovement",
        "riskChange",
      ]);

      if (!userId)
        return fail(res, 400, "VALIDATION_ERROR", "userId is required");
      if (!allowedEvents.has(normalizedEventType)) {
        return fail(
          res,
          400,
          "VALIDATION_ERROR",
          "eventType must be one of: rebalance, circuitBreaker, priceMovement, riskChange",
        );
      }

      const preferences = notificationService.getPreferences(userId);
      if (!preferences) {
        return fail(
          res,
          404,
          "NOT_FOUND",
          "No notification preferences found for this user",
        );
      }

      const payloadBase = {
        userId,
        eventType: normalizedEventType,
        timestamp: new Date().toISOString(),
      };

      const payloadByType = {
        rebalance: {
          title: "Test: Portfolio Rebalanced",
          message: "Test rebalance notification - 3 trades executed.",
          data: {
            portfolioId: "test-portfolio-123",
            trades: 3,
            gasUsed: "0.0234 XLM",
          },
        },
        circuitBreaker: {
          title: "Test: Circuit Breaker Triggered",
          message: "Test circuit breaker notification - BTC moved 22.5%.",
          data: { asset: "BTC", priceChange: "22.5", cooldownMinutes: 5 },
        },
        priceMovement: {
          title: "Test: Large Price Movement",
          message: "Test price movement notification - ETH up 12.34%.",
          data: { asset: "ETH", priceChange: "12.34", direction: "increased" },
        },
        riskChange: {
          title: "Test: Risk Level Changed",
          message: "Test risk change notification - Risk increased to high.",
          data: {
            portfolioId: "test-portfolio-123",
            oldLevel: "medium",
            newLevel: "high",
          },
        },
      } as const;

      await notificationService.notify({
        ...payloadBase,
        ...payloadByType[normalizedEventType],
      });

      logger.info("Debug test notification sent", {
        userId,
        eventType: normalizedEventType,
      });
      return ok(res, {
        message: "Test notification sent successfully",
        eventType: normalizedEventType,
        sentTo: {
          email: preferences.emailEnabled ? preferences.emailAddress : null,
          webhook: preferences.webhookEnabled ? preferences.webhookUrl : null,
        },
      });
    } catch (error) {
      logger.error("Failed to send debug test notification", {
        error: getErrorObject(error),
      });
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.get(
  "/debug/coingecko-test",
  blockDebugInProduction,
  async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.COINGECKO_API_KEY;

      // Test direct API call
      const testUrl = apiKey
        ? "https://pro-api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        : "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "StellarPortfolioRebalancer/1.0",
      };

      if (apiKey) {
        headers["x-cg-pro-api-key"] = apiKey;
      }

      logger.info("[DEBUG] Test URL", { testUrl });

      const response = await fetch(testUrl, { headers });
      const data = await response.json();

      return ok(res, {
        apiKeySet: !!apiKey,
        testUrl,
        responseStatus: response.status,
        responseData: data,
      });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error), {
        stack: error instanceof Error ? error.stack : String(error),
      });
    }
  },
);

router.get(
  "/debug/force-fresh-prices",
  blockDebugInProduction,
  async (req: Request, res: Response) => {
    try {
      logger.info("[DEBUG] Clearing cache and forcing fresh prices...");

      // Clear cache first
      reflectorService.clearCache();

      // Get cache status
      const cacheStatus = reflectorService.getCacheStatus();

      // Force a fresh API call
      const result = await reflectorService.getCurrentPrices();

      return ok(res, {
        cacheCleared: true,
        cacheStatusAfterClear: cacheStatus,
        freshPrices: result,
      });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.get(
  "/debug/reflector-test",
  blockDebugInProduction,
  async (req: Request, res: Response) => {
    try {
      logger.info("[DEBUG] Testing reflector service...");

      const testResult = await reflectorService.testApiConnectivity();
      const cacheStatus = reflectorService.getCacheStatus();

      return ok(res, {
        apiConnectivityTest: testResult,
        cacheStatus,
        environment: {
          nodeEnv: global.process.env.NODE_ENV,
          apiKeySet: !!global.process.env.COINGECKO_API_KEY,
          apiKeyLength: global.process.env.COINGECKO_API_KEY?.length || 0,
        },
      });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);

router.get(
  "/debug/env",
  blockDebugInProduction,
  async (req: Request, res: Response) => {
    try {
      return ok(res, {
        environment: global.process.env.NODE_ENV,
        apiKeySet: !!global.process.env.COINGECKO_API_KEY,
        autoRebalancerEnabled: !!autoRebalancer,
        autoRebalancerRunning: autoRebalancer
          ? autoRebalancer.getStatus().isRunning
          : false,
        enableAutoRebalancer: global.process.env.ENABLE_AUTO_REBALANCER,
        port: global.process.env.PORT,
      });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error));
    }
  },
);
router.get(
  "/debug/auto-rebalancer-test",
  blockDebugInProduction,
  async (req: Request, res: Response) => {
    try {
      if (!autoRebalancer) {
        return fail(
          res,
          500,
          "INTERNAL_ERROR",
          "Auto-rebalancer not initialized",
          {
            autoRebalancerAvailable: false,
          },
        );
      }

      const status = autoRebalancer.getStatus();
      const statistics = await autoRebalancer.getStatistics();
      const portfolioCount = await portfolioStorage.getPortfolioCount();

      return ok(res, {
        autoRebalancerAvailable: true,
        status,
        statistics,
        portfolioCount,
        testTimestamp: new Date().toISOString(),
      });
    } catch (error) {
      return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error), {
        autoRebalancerAvailable: false,
      });
    }
  },
);

// ================================
// QUEUE HEALTH ROUTE
// ================================

/**
 * GET /api/queue/health
 * Returns BullMQ queue depths and Redis connectivity status.
 * Used for worker health monitoring and alerting (issue #38).
 */
router.get('/queue/health', async (req: Request, res: Response) => {
    try {
        const metrics = await getQueueMetrics()
        const workers = {
            portfolioCheck: getPortfolioCheckWorkerStatus(),
            rebalance: getRebalanceWorkerStatus(),
            analyticsSnapshot: getAnalyticsSnapshotWorkerStatus(),
        }
        const payload = { ...metrics, workers }
        if (metrics.redisConnected) {
            return ok(res, payload)
        }
        return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Redis unavailable', payload)
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error), {
            redisConnected: false
        })
    }
    return fail(res, 503, "SERVICE_UNAVAILABLE", "Redis unavailable", metrics);
  } catch (error) {
    return fail(res, 500, "INTERNAL_ERROR", getErrorMessage(error), {
      redisConnected: false,
    });
  }
});

export { router as portfolioRouter };
