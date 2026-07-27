import { WebSocketServer } from "ws";
import { StellarService } from "../services/stellar.js";
import { ReflectorService } from "../services/reflector.js";
import {
  rebalanceHistoryService,
  riskManagementService,
} from "../services/serviceContainer.js";
import { portfolioStorage } from "../services/portfolioStorage.js";
import { getPortfolioCheckQueue } from "../queue/queues.js";
import { getRequestId } from "../utils/requestContext.js";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import {
  recordAnomaly,
  getAnomalySummary,
  resetAnomalyCounts,
} from "./anomalyTracker.js";
import type { Portfolio, RiskAlert } from "../types/index.js";

export class RebalancingService {
  private stellarService: StellarService;
  private reflectorService: ReflectorService;
  private wss: WebSocketServer;

  constructor(wss: WebSocketServer) {
    this.stellarService = new StellarService();
    this.reflectorService = new ReflectorService();
    this.wss = wss;
  }

  /**
   * Start the monitoring service.
   * Recurring portfolio checks and risk metric updates are now handled by
   * the BullMQ portfolio-check worker. This method sets up WebSocket
   * broadcasting hooks only.
   *
   * NOTE: node-cron schedules have been removed – replaced by the queue
   * scheduler in src/queue/scheduler.ts.
   */
  start() {
    logger.info(
      "[REBALANCING-SERVICE] Monitoring service started (queue-backed). WebSocket broadcasting active.",
    );
  }

  /**
   * Record an anomaly occurrence for operational monitoring.
   * Delegates to the shared anomaly tracker so ops routes can also record.
   */
  recordAnomaly(
    type:
      | "risk_alert"
      | "rebalance_block"
      | "price_feed_anomaly"
      | "circuit_breaker_trigger",
    severity?: "critical" | "warning" | "info",
  ): void {
    recordAnomaly(type, severity);
  }

  /**
   * Get the current anomaly summary for ops dashboards.
   */
  getAnomalySummary() {
    return getAnomalySummary();
  }

  /**
   * Reset all anomaly counters.
   */
  resetAnomalyCounts(): void {
    resetAnomalyCounts();
  }

  /**
   * Manually check a specific portfolio and broadcast results via WebSocket.
   */
  async forceCheckPortfolio(portfolioId: string): Promise<any> {
    try {
      await this.checkPortfolioForRebalancing(portfolioId);
      return { success: true, message: "Portfolio check completed" };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Force check failed for portfolio ${portfolioId}:`, {
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  async getStatus(): Promise<any> {
    const stats = await rebalanceHistoryService.getHistoryStats();
    const circuitBreakers = riskManagementService.getCircuitBreakerStatus();
    const active = await this.getActivePortfolios();
    return {
      activePortfolios: active.length,
      rebalanceHistory: stats,
      circuitBreakers,
      riskManagement: { enabled: true, lastUpdate: new Date().toISOString() },
      anomalySummary: this.getAnomalySummary(),
    };
  }

  // ─── Internal helpers (used by forceCheckPortfolio) ──────────────────────

  private async checkPortfolioForRebalancing(portfolioId: string) {
    try {
      const prices = await this.reflectorService.getCurrentPrices();
      const portfolio = await this.stellarService.getPortfolio(portfolioId);

      const riskAlerts = riskManagementService.updatePriceData(prices);
      const needsRebalance =
        await this.stellarService.checkRebalanceNeeded(portfolioId);

      if (needsRebalance) {
        logger.info(
          `Portfolio ${portfolioId} needs rebalancing – enqueueing job`,
        );

        // Use the stored portfolio (Record<string, number> allocations) for risk checks,
        // NOT the UI response from stellarService.getPortfolio() which has an array shape.
        const storedPortfolio =
          await portfolioStorage.getPortfolio(portfolioId);
        if (!storedPortfolio) {
          logger.warn(
            `Portfolio ${portfolioId} not found in storage during risk check`,
          );
          return;
        }
        const riskCheck = riskManagementService.shouldAllowRebalance(
          storedPortfolio,
          prices,
        );

        if (!riskCheck.allowed) {
          this.recordAnomaly("rebalance_block");
        }

        if (riskCheck.allowed) {
          // Enqueue a rebalance job rather than executing inline
          const queue = getPortfolioCheckQueue();
          if (queue) {
            await queue.add(
              `manual-check-${portfolioId}`,
              {
                triggeredBy: "manual",
                correlationId: getRequestId() || randomUUID(),
              },
              { priority: 1 },
            );
            this.notifyClients(portfolioId, "rebalance_queued", {
              message: "Rebalance job enqueued",
            });
          }
        } else {
          logger.warn(
            `Rebalancing blocked for ${portfolioId}: ${riskCheck.reason}`,
          );
          this.notifyClients(portfolioId, "rebalance_blocked", {
            message: "Rebalancing temporarily blocked by safety systems",
            reason: riskCheck.reason,
            alerts: riskCheck.alerts,
          });

          await rebalanceHistoryService.recordRebalanceEvent({
            portfolioId,
            trigger: "Automatic Check – Blocked",
            trades: 0,
            gasUsed: "0 XLM",
            status: "failed",
            prices,
            portfolio: storedPortfolio,
          });
        }
      }

      if (riskAlerts.length > 0) {
        const criticalAlerts = riskAlerts.filter(
          (a: RiskAlert) => a.severity === "critical",
        );
        const warningAlerts = riskAlerts.filter(
          (a: RiskAlert) => a.severity === "warning",
        );
        if (criticalAlerts.length > 0) {
          this.notifyClients(portfolioId, "risk_alert", {
            message: "Critical risk conditions detected",
            alerts: criticalAlerts,
          });
          this.recordAnomaly("risk_alert", "critical");
        }
        if (warningAlerts.length > 0) {
          this.recordAnomaly("risk_alert", "warning");
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to check portfolio ${portfolioId} for rebalancing:`,
        {
          error: errorMessage,
          portfolioId,
        },
      );
    }
  }

  private async getActivePortfolios(): Promise<
    Array<{ id: string; autoRebalance: boolean }>
  > {
    const allPortfolios = await portfolioStorage.getAllPortfolios();
    return allPortfolios
      .filter((p: Portfolio) => p.threshold > 0)
      .map((p: Portfolio) => ({ id: p.id, autoRebalance: true }));
  }

  private notifyClients(portfolioId: string, event: string, data: any = {}) {
    const message = JSON.stringify({
      type: "portfolio_update",
      portfolioId,
      event,
      data,
      timestamp: new Date().toISOString(),
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(message);
    });

    logger.info(`Notification sent: ${event} for portfolio ${portfolioId}`);
  }

  private broadcastToAllClients(event: string, data: any = {}) {
    const message = JSON.stringify({
      type: "market_update",
      event,
      data,
      timestamp: new Date().toISOString(),
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(message);
    });

    logger.info(`Market broadcast sent: ${event}`);
  }
}
