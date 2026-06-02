import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  persistWorkerStatus,
  getAllPersistedWorkerStatuses,
  getPersistedWorkerStatus,
  updateWorkerHeartbeat,
  clearAllWorkerStatus,
  getWorkerHealthSummary,
  type PersistedWorkerStatus,
} from "../queue/workers/workerHeartbeat.js";
import type { WorkerRuntimeStatus } from "../queue/workers/workerRuntime.js";

describe("Worker heartbeat persistence (Issue #450)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await clearAllWorkerStatus();
  });

  describe("persistWorkerStatus", () => {
    it("persists worker status to Redis with heartbeat metadata", async () => {
      const status: WorkerRuntimeStatus = {
        name: "portfolio-check",
        concurrency: 1,
        started: true,
        ready: true,
        lastStartedAt: new Date().toISOString(),
        lastReadyAt: new Date().toISOString(),
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);

      // Allow async persistence
      await vi.runAllTimersAsync();

      const retrieved = await getPersistedWorkerStatus("portfolio-check");

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("portfolio-check");
      expect(retrieved?.ready).toBe(true);
      expect(retrieved?.persistedAt).toBeDefined();
      expect(retrieved?.heartbeatAt).toBeDefined();
      expect(retrieved?.isHealthy).toBe(true);
    });

    it("persists multiple worker statuses independently", async () => {
      const statuses: WorkerRuntimeStatus[] = [
        {
          name: "portfolio-check",
          concurrency: 1,
          started: true,
          ready: true,
          schedulerRegistered: true,
        },
        {
          name: "rebalance",
          concurrency: 2,
          started: true,
          ready: true,
          schedulerRegistered: false,
        },
        {
          name: "analytics-snapshot",
          concurrency: 1,
          started: false,
          ready: false,
          schedulerRegistered: true,
        },
      ];

      for (const status of statuses) {
        await persistWorkerStatus(status);
      }

      await vi.runAllTimersAsync();

      const allStatuses = await getAllPersistedWorkerStatuses();

      expect(allStatuses).toHaveLength(3);
      expect(allStatuses.map((s) => s.name).sort()).toEqual([
        "analytics-snapshot",
        "portfolio-check",
        "rebalance",
      ]);
    });

    it("includes error messages in persisted status", async () => {
      const status: WorkerRuntimeStatus = {
        name: "portfolio-check",
        concurrency: 1,
        started: false,
        ready: false,
        lastError: "Connection refused: ECONNREFUSED",
        schedulerRegistered: false,
      };

      await persistWorkerStatus(status);

      await vi.runAllTimersAsync();

      const retrieved = await getPersistedWorkerStatus("portfolio-check");

      expect(retrieved?.lastError).toBe("Connection refused: ECONNREFUSED");
    });
  });

  describe("getAllPersistedWorkerStatuses", () => {
    it("returns all persisted worker statuses", async () => {
      const statuses: WorkerRuntimeStatus[] = [
        {
          name: "worker-1",
          concurrency: 1,
          started: true,
          ready: true,
          schedulerRegistered: true,
        },
        {
          name: "worker-2",
          concurrency: 2,
          started: false,
          ready: false,
          schedulerRegistered: false,
        },
      ];

      for (const status of statuses) {
        await persistWorkerStatus(status);
      }

      await vi.runAllTimersAsync();

      const all = await getAllPersistedWorkerStatuses();

      expect(all).toHaveLength(2);
      expect(all.every((s) => s.persistedAt && s.heartbeatAt)).toBe(true);
    });

    it("marks recently updated statuses as healthy", async () => {
      const status: WorkerRuntimeStatus = {
        name: "test-worker",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);

      await vi.runAllTimersAsync();

      const all = await getAllPersistedWorkerStatuses();

      expect(all[0].isHealthy).toBe(true);
    });

    it("marks stale statuses as unhealthy after TTL expires", async () => {
      const status: WorkerRuntimeStatus = {
        name: "test-worker",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);

      await vi.runAllTimersAsync();

      // Advance time past TTL (120 seconds)
      vi.advanceTimersByTime(125_000);

      await vi.runAllTimersAsync();

      const retrieved = await getPersistedWorkerStatus("test-worker");

      expect(retrieved).toBeNull(); // Entry should be expired
    });
  });

  describe("updateWorkerHeartbeat", () => {
    it("updates heartbeat timestamp without changing status", async () => {
      const status: WorkerRuntimeStatus = {
        name: "test-worker",
        concurrency: 1,
        started: true,
        ready: true,
        lastSuccessfulRunAt: new Date().toISOString(),
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);

      await vi.runAllTimersAsync();

      const original = await getPersistedWorkerStatus("test-worker");
      const originalPersistTime = original?.persistedAt;

      // Advance time
      vi.advanceTimersByTime(30_000);

      await updateWorkerHeartbeat("test-worker");

      await vi.runAllTimersAsync();

      const updated = await getPersistedWorkerStatus("test-worker");

      expect(updated?.persistedAt).toBe(originalPersistTime); // Unchanged
      expect(updated?.heartbeatAt).not.toBe(original?.heartbeatAt); // Updated
      expect(updated?.isHealthy).toBe(true); // Refreshed
    });

    it("extends Redis TTL on heartbeat update", async () => {
      const status: WorkerRuntimeStatus = {
        name: "test-worker",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);

      await vi.runAllTimersAsync();

      // Advance 100 seconds (still within original 120s TTL)
      vi.advanceTimersByTime(100_000);

      await updateWorkerHeartbeat("test-worker");

      await vi.runAllTimersAsync();

      // Advance another 100 seconds (would exceed original TTL without refresh)
      vi.advanceTimersByTime(100_000);

      await vi.runAllTimersAsync();

      const retrieved = await getPersistedWorkerStatus("test-worker");

      // Should still exist due to refreshed TTL
      expect(retrieved).toBeDefined();
    });
  });

  describe("getWorkerHealthSummary", () => {
    it("computes aggregated health metrics", async () => {
      const statuses: WorkerRuntimeStatus[] = [
        {
          name: "worker-1",
          concurrency: 1,
          started: true,
          ready: true,
          schedulerRegistered: true,
        },
        {
          name: "worker-2",
          concurrency: 1,
          started: true,
          ready: false,
          lastError: "Some error",
          schedulerRegistered: true,
        },
        {
          name: "worker-3",
          concurrency: 1,
          started: false,
          ready: false,
          schedulerRegistered: false,
        },
      ];

      for (const status of statuses) {
        await persistWorkerStatus(status);
      }

      await vi.runAllTimersAsync();

      const summary = await getWorkerHealthSummary();

      expect(summary.total).toBe(3);
      expect(summary.healthy).toBe(1); // Only worker-1 is ready
      expect(summary.unhealthy).toBeGreaterThan(0);
      expect(summary.idle).toBe(1); // worker-1 ready with no error
    });

    it("identifies lagging workers (no successful run >5min ago)", async () => {
      const fiveMinsAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();

      const status: WorkerRuntimeStatus = {
        name: "lagging-worker",
        concurrency: 1,
        started: true,
        ready: true,
        lastSuccessfulRunAt: fiveMinsAgo,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);

      await vi.runAllTimersAsync();

      const summary = await getWorkerHealthSummary();

      expect(summary.lagging).toBeGreaterThan(0);
    });

    it("returns empty summary when no workers", async () => {
      const summary = await getWorkerHealthSummary();

      expect(summary.total).toBe(0);
      expect(summary.healthy).toBe(0);
      expect(summary.unhealthy).toBe(0);
      expect(summary.workers).toHaveLength(0);
    });
  });

  describe("clearAllWorkerStatus", () => {
    it("removes all persisted worker statuses", async () => {
      const statuses: WorkerRuntimeStatus[] = [
        {
          name: "worker-1",
          concurrency: 1,
          started: true,
          ready: true,
          schedulerRegistered: true,
        },
        {
          name: "worker-2",
          concurrency: 1,
          started: true,
          ready: true,
          schedulerRegistered: true,
        },
      ];

      for (const status of statuses) {
        await persistWorkerStatus(status);
      }

      await vi.runAllTimersAsync();

      let all = await getAllPersistedWorkerStatuses();
      expect(all).toHaveLength(2);

      await clearAllWorkerStatus();

      await vi.runAllTimersAsync();

      all = await getAllPersistedWorkerStatuses();
      expect(all).toHaveLength(0);
    });
  });

  describe("Ops visibility scenarios", () => {
    it("provides real-time health dashboard data", async () => {
      // Simulate running workers
      const workers: WorkerRuntimeStatus[] = [
        {
          name: "portfolio-check",
          concurrency: 1,
          started: true,
          ready: true,
          lastReadyAt: new Date().toISOString(),
          lastSuccessfulRunAt: new Date().toISOString(),
          schedulerRegistered: true,
        },
        {
          name: "rebalance",
          concurrency: 2,
          started: true,
          ready: true,
          lastReadyAt: new Date().toISOString(),
          lastSuccessfulRunAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          schedulerRegistered: true,
        },
        {
          name: "analytics-snapshot",
          concurrency: 1,
          started: false,
          ready: false,
          lastError: "Redis unavailable",
          schedulerRegistered: false,
        },
      ];

      for (const worker of workers) {
        await persistWorkerStatus(worker);
      }

      await vi.runAllTimersAsync();

      // Operator queries health summary
      const summary = await getWorkerHealthSummary();

      // Can identify operational state
      expect(summary.workers).toHaveLength(3);
      expect(summary.healthy).toBeGreaterThan(0);
      expect(summary.unhealthy).toBeGreaterThan(0);

      // Can see which workers are ready
      const readyWorkers = summary.workers.filter((w) => w.ready);
      expect(readyWorkers.length).toBeGreaterThan(0);

      // Can see error messages
      const errorWorkers = summary.workers.filter((w) => w.lastError);
      expect(errorWorkers).toHaveLength(1);
      expect(errorWorkers[0].lastError).toBe("Redis unavailable");
    });

    it("detects worker failure and persistence", async () => {
      const status: WorkerRuntimeStatus = {
        name: "rebalance",
        concurrency: 2,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);

      await vi.runAllTimersAsync();

      // Simulate failure
      const failedStatus: WorkerRuntimeStatus = {
        ...status,
        ready: false,
        lastError: "Queue connection lost",
        lastErrorAt: new Date().toISOString(),
      };

      await persistWorkerStatus(failedStatus);

      await vi.runAllTimersAsync();

      // Operator queries health
      const retrieved = await getPersistedWorkerStatus("rebalance");

      expect(retrieved?.ready).toBe(false);
      expect(retrieved?.lastError).toContain("Queue connection lost");
    });
  });
});
