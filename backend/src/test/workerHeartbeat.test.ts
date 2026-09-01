import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  persistWorkerStatus,
  getAllPersistedWorkerStatuses,
  getPersistedWorkerStatus,
  updateWorkerHeartbeat,
  clearAllWorkerStatus,
  getWorkerHealthSummary,
  registerWorkerRestartHandler,
  unregisterWorkerRestartHandler,
  clearWorkerRestartHandlers,
  getRegisteredRestartHandlers,
  getWorkerSupervisorState,
  resetWorkerSupervisorState,
  superviseWorker,
  superviseAllWorkers,
  startWorkerSupervisor,
  stopWorkerSupervisor,
  DEFAULT_SUPERVISOR_CONFIG,
  type PersistedWorkerStatus,
} from "../queue/workers/workerHeartbeat.js";
import type { WorkerRuntimeStatus } from "../queue/workers/workerRuntime.js";

describe("Worker heartbeat persistence (Issue #450)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(async () => {
    stopWorkerSupervisor();
    clearWorkerRestartHandlers();
    resetWorkerSupervisorState();
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

describe("Crash auto-restart supervisor for worker heartbeat failures (Issue #1400)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    clearWorkerRestartHandlers();
    resetWorkerSupervisorState();
  });

  afterEach(async () => {
    stopWorkerSupervisor();
    clearWorkerRestartHandlers();
    resetWorkerSupervisorState();
    vi.useRealTimers();
    await clearAllWorkerStatus();
  });

  describe("Restart handler registration", () => {
    it("registers, retrieves, and unregisters worker restart handlers", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registerWorkerRestartHandler("portfolio-check", handler1);
      registerWorkerRestartHandler("rebalance", handler2);

      expect(getRegisteredRestartHandlers().sort()).toEqual(["portfolio-check", "rebalance"]);

      unregisterWorkerRestartHandler("portfolio-check");
      expect(getRegisteredRestartHandlers()).toEqual(["rebalance"]);

      clearWorkerRestartHandlers();
      expect(getRegisteredRestartHandlers()).toEqual([]);
    });
  });

  describe("Missed heartbeat detection", () => {
    it("recognizes healthy worker when heartbeat is active within timeout", async () => {
      const status: WorkerRuntimeStatus = {
        name: "portfolio-check",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);
      await vi.runAllTimersAsync();

      const result = await superviseWorker("portfolio-check", {
        missedHeartbeatThreshold: 3,
      });

      expect(result.action).toBe("healthy");
      expect(result.consecutiveMissedHeartbeats).toBe(0);
      expect(result.inCrashLoop).toBe(false);
    });

    it("increments consecutive missed heartbeats when worker does not send heartbeats", async () => {
      const status: WorkerRuntimeStatus = {
        name: "portfolio-check",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);
      await vi.runAllTimersAsync();

      // Advance time beyond heartbeat timeout (120s)
      vi.advanceTimersByTime(130_000);

      const check1 = await superviseWorker("portfolio-check", {
        missedHeartbeatThreshold: 3,
      });

      expect(check1.action).toBe("heartbeat_missed");
      expect(check1.consecutiveMissedHeartbeats).toBe(1);

      const check2 = await superviseWorker("portfolio-check", {
        missedHeartbeatThreshold: 3,
      });

      expect(check2.action).toBe("heartbeat_missed");
      expect(check2.consecutiveMissedHeartbeats).toBe(2);
    });

    it("resets consecutive missed heartbeat count when a worker becomes healthy again", async () => {
      const status: WorkerRuntimeStatus = {
        name: "portfolio-check",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);
      await vi.runAllTimersAsync();

      // Miss 2 heartbeats
      vi.advanceTimersByTime(130_000);
      await superviseWorker("portfolio-check", { missedHeartbeatThreshold: 3 });
      await superviseWorker("portfolio-check", { missedHeartbeatThreshold: 3 });

      expect(getWorkerSupervisorState("portfolio-check").consecutiveMissedHeartbeats).toBe(2);

      // Worker sends fresh status / heartbeat
      await persistWorkerStatus(status);
      await vi.runAllTimersAsync();

      const healthyCheck = await superviseWorker("portfolio-check", {
        missedHeartbeatThreshold: 3,
      });

      expect(healthyCheck.action).toBe("healthy");
      expect(healthyCheck.consecutiveMissedHeartbeats).toBe(0);
      expect(getWorkerSupervisorState("portfolio-check").consecutiveMissedHeartbeats).toBe(0);
    });
  });

  describe("Supervised restart execution", () => {
    it("does NOT trigger restart before reaching consecutive missed threshold", async () => {
      const restartHandler = vi.fn();
      registerWorkerRestartHandler("portfolio-check", restartHandler);

      const status: WorkerRuntimeStatus = {
        name: "portfolio-check",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);
      await vi.runAllTimersAsync();

      vi.advanceTimersByTime(130_000);

      // 1st missed check (threshold = 3)
      const res1 = await superviseWorker("portfolio-check", { missedHeartbeatThreshold: 3 });
      expect(res1.action).toBe("heartbeat_missed");
      expect(restartHandler).not.toHaveBeenCalled();

      // 2nd missed check
      const res2 = await superviseWorker("portfolio-check", { missedHeartbeatThreshold: 3 });
      expect(res2.action).toBe("heartbeat_missed");
      expect(restartHandler).not.toHaveBeenCalled();
    });

    it("triggers supervised restart when consecutive missed heartbeats reach threshold", async () => {
      const restartHandler = vi.fn().mockResolvedValue(undefined);
      registerWorkerRestartHandler("portfolio-check", restartHandler);

      const status: WorkerRuntimeStatus = {
        name: "portfolio-check",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      };

      await persistWorkerStatus(status);
      await vi.runAllTimersAsync();

      vi.advanceTimersByTime(130_000);

      // Miss 1, 2, 3
      await superviseWorker("portfolio-check", { missedHeartbeatThreshold: 3 });
      await superviseWorker("portfolio-check", { missedHeartbeatThreshold: 3 });
      const res3 = await superviseWorker("portfolio-check", { missedHeartbeatThreshold: 3 });

      expect(res3.action).toBe("restart_triggered");
      expect(restartHandler).toHaveBeenCalledTimes(1);
      expect(res3.restartCountInWindow).toBe(1);
      expect(res3.consecutiveMissedHeartbeats).toBe(0);
    });

    it("handles failure of restart handler gracefully", async () => {
      const restartHandler = vi.fn().mockRejectedValue(new Error("Worker spawn failed"));
      registerWorkerRestartHandler("rebalance", restartHandler);

      // No status persisted -> missed
      const res = await superviseWorker("rebalance", { missedHeartbeatThreshold: 1 });

      expect(res.action).toBe("restart_failed");
      expect(res.error).toBe("Worker spawn failed");
      expect(restartHandler).toHaveBeenCalledTimes(1);
    });

    it("returns no_handler if worker missed threshold but has no registered handler", async () => {
      const res = await superviseWorker("unregistered-worker", { missedHeartbeatThreshold: 1 });

      expect(res.action).toBe("no_handler");
    });
  });

  describe("Crash-loop protection & bounded restarts", () => {
    it("caps restart attempts within time window to prevent crash-loop resource exhaustion", async () => {
      let restartCount = 0;
      const restartHandler = vi.fn().mockImplementation(async () => {
        restartCount++;
      });
      registerWorkerRestartHandler("portfolio-check", restartHandler);

      const config = {
        missedHeartbeatThreshold: 1,
        maxRestartAttempts: 3,
        restartWindowMs: 5 * 60 * 1000, // 5 minutes
      };

      // 1st restart
      const r1 = await superviseWorker("portfolio-check", config);
      expect(r1.action).toBe("restart_triggered");
      expect(r1.restartCountInWindow).toBe(1);
      expect(r1.inCrashLoop).toBe(false);

      // 2nd restart
      const r2 = await superviseWorker("portfolio-check", config);
      expect(r2.action).toBe("restart_triggered");
      expect(r2.restartCountInWindow).toBe(2);
      expect(r2.inCrashLoop).toBe(false);

      // 3rd restart (reaches max limit)
      const r3 = await superviseWorker("portfolio-check", config);
      expect(r3.action).toBe("restart_triggered");
      expect(r3.restartCountInWindow).toBe(3);
      expect(r3.inCrashLoop).toBe(false);

      expect(restartHandler).toHaveBeenCalledTimes(3);

      // 4th attempt: crash-loop protection MUST trigger and block further restarts
      const r4 = await superviseWorker("portfolio-check", config);
      expect(r4.action).toBe("crash_loop_prevented");
      expect(r4.inCrashLoop).toBe(true);
      expect(r4.restartCountInWindow).toBe(3);
      // Restart handler is NOT called again
      expect(restartHandler).toHaveBeenCalledTimes(3);

      // 5th attempt: continues to be blocked
      const r5 = await superviseWorker("portfolio-check", config);
      expect(r5.action).toBe("crash_loop_prevented");
      expect(r5.inCrashLoop).toBe(true);
      expect(restartHandler).toHaveBeenCalledTimes(3);
    });

    it("recovers and allows restarts again after sliding window elapses", async () => {
      const restartHandler = vi.fn().mockResolvedValue(undefined);
      registerWorkerRestartHandler("portfolio-check", restartHandler);

      const config = {
        missedHeartbeatThreshold: 1,
        maxRestartAttempts: 2,
        restartWindowMs: 60_000, // 1 minute window
      };

      // Exhaust 2 attempts
      await superviseWorker("portfolio-check", config);
      await superviseWorker("portfolio-check", config);

      // 3rd attempt is blocked by crash loop
      const blocked = await superviseWorker("portfolio-check", config);
      expect(blocked.action).toBe("crash_loop_prevented");
      expect(blocked.inCrashLoop).toBe(true);
      expect(restartHandler).toHaveBeenCalledTimes(2);

      // Advance time past restartWindowMs
      vi.advanceTimersByTime(65_000);

      // Now old restarts have expired out of the window -> restart allowed again
      const recovered = await superviseWorker("portfolio-check", config);
      expect(recovered.action).toBe("restart_triggered");
      expect(recovered.inCrashLoop).toBe(false);
      expect(restartHandler).toHaveBeenCalledTimes(3);
    });

    it("reflects crash-looping workers in getWorkerHealthSummary", async () => {
      const restartHandler = vi.fn();
      registerWorkerRestartHandler("crashed-worker", restartHandler);

      const config = {
        missedHeartbeatThreshold: 1,
        maxRestartAttempts: 1,
        restartWindowMs: 60_000,
      };

      await superviseWorker("crashed-worker", config);
      // Trigger crash loop
      await superviseWorker("crashed-worker", config);

      const summary = await getWorkerHealthSummary();
      expect(summary.crashLooping).toBe(1);
      expect(summary.supervisor.find((s) => s.name === "crashed-worker")?.inCrashLoop).toBe(true);
    });
  });

  describe("Multi-worker supervision & periodic supervisor", () => {
    it("supervises multiple registered and persisted workers", async () => {
      const restart1 = vi.fn();
      const restart2 = vi.fn();

      registerWorkerRestartHandler("worker-a", restart1);
      registerWorkerRestartHandler("worker-b", restart2);

      // Worker A is healthy
      await persistWorkerStatus({
        name: "worker-a",
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: true,
      });

      // Worker B is unhealthy / never sent status
      const results = await superviseAllWorkers({ missedHeartbeatThreshold: 1 });

      const resA = results.find((r) => r.workerName === "worker-a");
      const resB = results.find((r) => r.workerName === "worker-b");

      expect(resA?.action).toBe("healthy");
      expect(restart1).not.toHaveBeenCalled();

      expect(resB?.action).toBe("restart_triggered");
      expect(restart2).toHaveBeenCalledTimes(1);
    });

    it("starts and stops periodic supervisor loop", async () => {
      const restart = vi.fn();
      registerWorkerRestartHandler("worker-loop", restart);

      const supervisor = startWorkerSupervisor({ missedHeartbeatThreshold: 1 }, 10_000);

      expect(supervisor).toBeDefined();

      // Advance time by 10s -> supervisor triggers
      await vi.advanceTimersByTimeAsync(10_000);

      expect(restart).toHaveBeenCalledTimes(1);

      supervisor.stop();

      // Advance time again -> no more triggers after stop
      await vi.advanceTimersByTimeAsync(30_000);

      expect(restart).toHaveBeenCalledTimes(1);
    });
  });
});
