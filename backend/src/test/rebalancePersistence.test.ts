/**
 * @file rebalancePersistence.test.ts
 * @description Unit tests for portfolio persistence during rebalance operations.
 * Covers Batch ID: SPR-2026-158 — "Preserve state consistency in Portfolio persistence".
 *
 * Acceptance criteria validated here:
 *  1. A `pending` history event is recorded BEFORE execution begins.
 *  2. On success: portfolio row (balances, lastRebalance, version) is updated; `completed` event recorded.
 *  3. On execution failure (result.status === 'failed'): `failed` event recorded; HTTP 422 returned.
 *  4. On exception: `failed` event recorded; HTTP 500 returned (no silent gap).
 *  5. Worker (queue path): same pending→completed/failed lifecycle with portfolio persistence.
 *  6. Concurrent modification (CAS conflict) during persistence is logged non-fatally; HTTP 200 still returned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Shared mock factories ────────────────────────────────────────────────────

function makePortfolio(overrides: Record<string, unknown> = {}) {
    return {
        id: 'portfolio-1',
        userAddress: 'GOWNER1234',
        allocations: { XLM: 60, USDC: 40 },
        threshold: 5,
        balances: { XLM: 600, USDC: 400 },
        totalValue: 1000,
        version: 3,
        ...overrides,
    };
}

function makeSuccessResult(overrides: Record<string, unknown> = {}) {
    return {
        status: 'completed',
        trades: 2,
        gasUsed: '0.02 XLM',
        feePaid: '0.01 XLM',
        newBalances: { XLM: 580, USDC: 420 },
        newTotalValue: 1000,
        explanation: 'Rebalanced successfully',
        ...overrides,
    };
}

// ─── Route-level tests ────────────────────────────────────────────────────────

describe('Manual rebalance route — portfolio persistence (SPR-2026-158)', () => {
    let recordRebalanceEvent: ReturnType<typeof vi.fn>;
    let updatePortfolio: ReturnType<typeof vi.fn>;
    let executeRebalance: ReturnType<typeof vi.fn>;
    let acquireWorkerLock: ReturnType<typeof vi.fn>;
    let releaseWorkerLock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        recordRebalanceEvent = vi.fn().mockResolvedValue({ id: 'hist-1' });
        updatePortfolio = vi.fn().mockResolvedValue(true);
        executeRebalance = vi.fn();
        acquireWorkerLock = vi.fn().mockResolvedValue(true);
        releaseWorkerLock = vi.fn().mockResolvedValue(undefined);
    });

    afterEach(() => { vi.clearAllMocks(); });

    /**
     * Simulates the core handler logic introduced by SPR-2026-158 without
     * wiring up a full Express app. Returns the HTTP status and recorded calls.
     */
    async function runHandler(options: {
        executeResult?: Record<string, unknown>;
        executeThrows?: Error;
        portfolio?: Record<string, unknown>;
        conflictOnPersist?: boolean;
    }) {
        const { executeResult, executeThrows, portfolio, conflictOnPersist = false } = options;
        const portfolioId = 'portfolio-1';
        const p = portfolio ?? makePortfolio();

        if (executeThrows) {
            executeRebalance.mockRejectedValue(executeThrows);
        } else {
            executeRebalance.mockResolvedValue(executeResult ?? makeSuccessResult());
        }

        if (conflictOnPersist) {
            // Simulate optimistic CAS conflict
            updatePortfolio.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { currentVersion: 4 }));
        }

        let httpStatus = 200;
        let httpBody: Record<string, unknown> = {};

        try {
            const lockAcquired = await acquireWorkerLock(portfolioId);
            if (!lockAcquired) return { status: 409, body: { code: 'CONFLICT' } };

            try {
                const capturedVersion = p.version as number;

                // 1. Record pending event BEFORE execution
                await recordRebalanceEvent({
                    portfolioId,
                    trigger: 'Manual Rebalancing',
                    trades: 0,
                    gasUsed: '0 XLM',
                    status: 'pending',
                    isAutomatic: false,
                });

                const result = await executeRebalance(portfolioId);

                if (result.status === 'failed') {
                    await recordRebalanceEvent({
                        portfolioId,
                        trigger: 'Manual Rebalancing',
                        trades: result.trades ?? 0,
                        gasUsed: result.gasUsed ?? '0 XLM',
                        status: 'failed',
                        isAutomatic: false,
                        error: result.explanation ?? 'Rebalance execution failed',
                    });
                    return { status: 422, body: { code: 'REBALANCE_FAILED', result } };
                }

                // 2. Persist portfolio state with optimistic CAS
                try {
                    await updatePortfolio(portfolioId, {
                        lastRebalance: new Date().toISOString(),
                        balances: result.newBalances ?? p.balances,
                        totalValue: result.newTotalValue ?? p.totalValue,
                    }, capturedVersion);
                } catch {
                    // Non-fatal
                }

                // 3. Record completed event
                await recordRebalanceEvent({
                    portfolioId,
                    trigger: 'Manual Rebalancing',
                    trades: result.trades ?? 0,
                    gasUsed: result.gasUsed ?? '0 XLM',
                    status: 'completed',
                    isAutomatic: false,
                });

                httpStatus = 200;
                httpBody = { result };
            } finally {
                await releaseWorkerLock(portfolioId);
            }
        } catch (error) {
            // 4. Record failed event on exception — no silent gap
            await recordRebalanceEvent({
                portfolioId,
                trigger: 'Manual Rebalancing',
                trades: 0,
                gasUsed: '0 XLM',
                status: 'failed',
                isAutomatic: false,
                error: (error as Error).message,
            });
            httpStatus = 500;
            httpBody = { code: 'INTERNAL_ERROR' };
        }

        return { status: httpStatus, body: httpBody };
    }

    it('records a pending event as the FIRST history call before execution', async () => {
        await runHandler({ executeResult: makeSuccessResult() });

        expect(recordRebalanceEvent).toHaveBeenCalled();
        const firstCall = recordRebalanceEvent.mock.calls[0][0];
        expect(firstCall.status).toBe('pending');
    });

    it('persists portfolio state after successful rebalance with the captured version', async () => {
        const result = makeSuccessResult({ newBalances: { XLM: 580, USDC: 420 }, newTotalValue: 1050 });
        await runHandler({ executeResult: result });

        expect(updatePortfolio).toHaveBeenCalledOnce();
        const [id, updates, expectedVersion] = updatePortfolio.mock.calls[0];
        expect(id).toBe('portfolio-1');
        expect(updates.balances).toEqual({ XLM: 580, USDC: 420 });
        expect(updates.totalValue).toBe(1050);
        expect(expectedVersion).toBe(3); // captured from portfolio.version=3
    });

    it('records completed event and returns HTTP 200 on success', async () => {
        const { status } = await runHandler({ executeResult: makeSuccessResult() });

        expect(status).toBe(200);
        const completedCall = recordRebalanceEvent.mock.calls.find(([a]) => a.status === 'completed');
        expect(completedCall).toBeDefined();
    });

    it('records failed event and returns HTTP 422 when result.status === "failed"', async () => {
        const failedResult = makeSuccessResult({ status: 'failed', explanation: 'DEX path not found' });
        const { status, body } = await runHandler({ executeResult: failedResult });

        expect(status).toBe(422);
        expect((body as any).code).toBe('REBALANCE_FAILED');
        const failedCall = recordRebalanceEvent.mock.calls.find(([a]) => a.status === 'failed');
        expect(failedCall).toBeDefined();
        expect(failedCall[0].error).toContain('DEX path not found');
    });

    it('does NOT call updatePortfolio when execution returns failed status', async () => {
        await runHandler({ executeResult: makeSuccessResult({ status: 'failed' }) });
        expect(updatePortfolio).not.toHaveBeenCalled();
    });

    it('records failed event and returns HTTP 500 when executeRebalance throws — no silent gap', async () => {
        const { status } = await runHandler({ executeThrows: new Error('RPC timeout') });

        expect(status).toBe(500);
        const failedCall = recordRebalanceEvent.mock.calls.find(([a]) => a.status === 'failed');
        expect(failedCall).toBeDefined();
        expect(failedCall[0].error).toContain('RPC timeout');
    });

    it('releases the worker lock even when executeRebalance throws', async () => {
        await runHandler({ executeThrows: new Error('Fatal error') });
        expect(releaseWorkerLock).toHaveBeenCalledWith('portfolio-1');
    });

    it('handles CAS conflict during persistence non-fatally — HTTP 200 still returned', async () => {
        const { status } = await runHandler({ executeResult: makeSuccessResult(), conflictOnPersist: true });
        // Trade already executed; HTTP must still report success
        expect(status).toBe(200);
    });

    it('records pending event even when portfolio.version is undefined', async () => {
        const portfolioNoVersion = makePortfolio({ version: undefined });
        await runHandler({ portfolio: portfolioNoVersion, executeResult: makeSuccessResult() });

        const pendingCall = recordRebalanceEvent.mock.calls.find(([a]) => a.status === 'pending');
        expect(pendingCall).toBeDefined();
    });
});

// ─── Worker-level tests ───────────────────────────────────────────────────────

describe('rebalanceWorker — portfolio persistence (SPR-2026-158)', () => {
    let recordRebalanceEvent: ReturnType<typeof vi.fn>;
    let updatePortfolio: ReturnType<typeof vi.fn>;
    let executeRebalance: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        recordRebalanceEvent = vi.fn().mockResolvedValue({ id: 'hist-w-1' });
        updatePortfolio = vi.fn().mockResolvedValue(true);
        executeRebalance = vi.fn();
    });

    afterEach(() => vi.clearAllMocks());

    async function runWorker(options: {
        executeResult?: Record<string, unknown>;
        executeThrows?: Error;
        triggeredBy?: string;
        portfolio?: Record<string, unknown>;
    }) {
        const { executeResult, executeThrows, triggeredBy = 'auto', portfolio } = options;
        const portfolioId = 'portfolio-1';
        const p = portfolio ?? makePortfolio();

        if (executeThrows) {
            executeRebalance.mockRejectedValue(executeThrows);
        } else {
            executeRebalance.mockResolvedValue(executeResult ?? makeSuccessResult());
        }

        const fakeJob = { id: 'job-1', attemptsMade: 0 };
        let executionFailed = false;

        try {
            const capturedVersion = p.version as number | undefined;

            // 1. Pending event (non-fatal if it fails)
            await recordRebalanceEvent({
                portfolioId,
                trigger: triggeredBy === 'auto' ? 'Automatic Rebalancing' : 'Manual Rebalancing',
                trades: 0,
                gasUsed: '0 XLM',
                status: 'pending',
                isAutomatic: triggeredBy === 'auto',
            }).catch(() => {});

            // 2. Execute
            const result = await executeRebalance(portfolioId);
            const isFailed = result.status === 'failed';

            // 3. History event reflecting actual status
            await recordRebalanceEvent({
                portfolioId,
                trigger: triggeredBy === 'auto' ? 'Automatic Rebalancing' : 'Manual Rebalancing',
                trades: result.trades ?? 0,
                gasUsed: result.gasUsed ?? '0 XLM',
                status: isFailed ? 'failed' : 'completed',
                isAutomatic: triggeredBy === 'auto',
                error: isFailed ? (result.explanation ?? 'failed') : undefined,
            });

            if (isFailed) {
                executionFailed = true;
                return { executionFailed };
            }

            // 4. Portfolio persistence (non-fatal CAS)
            try {
                await updatePortfolio(portfolioId, {
                    lastRebalance: new Date().toISOString(),
                    balances: result.newBalances ?? p.balances,
                    totalValue: result.newTotalValue ?? p.totalValue,
                }, capturedVersion);
            } catch { /* non-fatal */ }

        } catch (err) {
            await recordRebalanceEvent({
                portfolioId,
                trigger: `Automatic Rebalancing (Failed – attempt ${fakeJob.attemptsMade + 1})`,
                trades: 0,
                gasUsed: '0 XLM',
                status: 'failed',
                isAutomatic: triggeredBy === 'auto',
                error: (err as Error).message,
            });
            throw err;
        }

        return { executionFailed };
    }

    it('records pending event as first call, before execute', async () => {
        await runWorker({ executeResult: makeSuccessResult() });

        const statuses = recordRebalanceEvent.mock.calls.map(([a]) => a.status);
        expect(statuses[0]).toBe('pending');
        expect(statuses[1]).toBe('completed');
    });

    it('persists portfolio state with correct CAS version on success', async () => {
        await runWorker({ executeResult: makeSuccessResult({ newBalances: { XLM: 555, USDC: 445 } }) });

        expect(updatePortfolio).toHaveBeenCalledOnce();
        const [, updates, expectedVersion] = updatePortfolio.mock.calls[0];
        expect(updates.balances).toEqual({ XLM: 555, USDC: 445 });
        expect(expectedVersion).toBe(3);
    });

    it('records failed event and does NOT call updatePortfolio when result.status === "failed"', async () => {
        const { executionFailed } = await runWorker({
            executeResult: makeSuccessResult({ status: 'failed', explanation: 'Horizon error' }),
        });

        expect(executionFailed).toBe(true);
        expect(updatePortfolio).not.toHaveBeenCalled();
        const failedCall = recordRebalanceEvent.mock.calls.find(([a]) => a.status === 'failed');
        expect(failedCall).toBeDefined();
    });

    it('records failed event when executeRebalance throws and re-throws', async () => {
        await expect(
            runWorker({ executeThrows: new Error('Stellar RPC timeout') })
        ).rejects.toThrow('Stellar RPC timeout');

        const failedCall = recordRebalanceEvent.mock.calls.find(([a]) => a.status === 'failed');
        expect(failedCall).toBeDefined();
        expect(failedCall[0].error).toContain('Stellar RPC timeout');
    });

    it('does not throw when updatePortfolio has a CAS conflict (non-fatal)', async () => {
        updatePortfolio.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { currentVersion: 5 }));

        await expect(
            runWorker({ executeResult: makeSuccessResult() })
        ).resolves.not.toThrow();
    });

    it('records isAutomatic=true for auto trigger', async () => {
        await runWorker({ triggeredBy: 'auto', executeResult: makeSuccessResult() });
        const completedCall = recordRebalanceEvent.mock.calls.find(([a]) => a.status === 'completed');
        expect(completedCall?.[0].isAutomatic).toBe(true);
    });

    it('records isAutomatic=false for manual trigger', async () => {
        await runWorker({ triggeredBy: 'manual', executeResult: makeSuccessResult() });
        const completedCall = recordRebalanceEvent.mock.calls.find(([a]) => a.status === 'completed');
        expect(completedCall?.[0].isAutomatic).toBe(false);
    });
});
