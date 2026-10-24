/**
 * SPR-2026-156 — [API] Define boundary handling for Portfolio persistence
 *
 * Test suite verifying boundary handling for allocation edits during the
 * portfolio rebalancing lifecycle at the service boundary.
 *
 * Verifies that:
 * 1. An allocation edit during an active rebalance is rejected at the service boundary
 *    with executionState='rebalancing', stable result='conflict_rebalancing', and documents
 *    the current committedVersion without mutating stored allocations.
 * 2. An allocation edit submitted with a stale expectedVersion (after a rebalance advances version)
 *    is rejected with stable result='conflict_version' and documents the latest committedVersion.
 * 3. A subsequent sequential allocation edit targeting the updated version succeeds and
 *    documents committedVersion and executionState='idle' with stable result='committed'.
 * 4. Allocation weight validation errors return stable result='validation_error' and do not mutate state.
 * 5. Non-existent portfolio IDs return stable result='not_found'.
 * 6. HTTP API routes (/portfolio/:id/allocations and /portfolio/:id) document committedVersion,
 *    executionState, and stable result across 200, 400, 404, and 409 responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { Portfolio } from '../types/index.js'
import { ConflictError } from '../types/index.js'
import {
    applyAllocationEdit,
    markRebalanceActive,
    markRebalanceInactive,
    resetRebalanceStateTracker,
    getRebalanceExecutionState,
    isRebalanceActive,
    isRebalanceActiveSync,
} from '../services/portfolioPersistenceBoundary.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { databaseService } from '../services/databaseService.js'

// ── In-Memory Mock Storage Double ─────────────────────────────────────────────

function createMockStorage(initialPortfolio?: Portfolio) {
    let current = initialPortfolio ? { ...initialPortfolio } : undefined
    return {
        getPortfolio: vi.fn(async (id: string) => {
            if (!current || current.id !== id) return undefined
            return { ...current }
        }),
        updatePortfolio: vi.fn(async (id: string, updates: Partial<Portfolio>, expectedVersion?: number) => {
            if (!current || current.id !== id) return false
            if (expectedVersion !== undefined && current.version !== expectedVersion) {
                throw new ConflictError(
                    `Version conflict: expected ${expectedVersion}, got ${current.version}`,
                    current.version
                )
            }
            const nextVersion = (current.version ?? 1) + 1
            current = {
                ...current,
                ...updates,
                version: nextVersion,
            }
            return true
        }),
        getCurrent: () => current,
    }
}

describe('SPR-2026-156 — Service Boundary: applyAllocationEdit', () => {
    const portfolioId = 'portfolio-spr-156-test'
    const initialPortfolio: Portfolio = {
        id: portfolioId,
        userAddress: 'GUSER1111111111111111111111111111111111111111111111111111111',
        allocations: { XLM: 60, USDC: 40 },
        threshold: 5,
        version: 1,
        createdAt: '2026-10-22T00:00:00.000Z',
    }

    beforeEach(() => {
        resetRebalanceStateTracker()
    })

    it('successfully commits allocation edit when idle and documents committed version and state', async () => {
        const mockStorage = createMockStorage(initialPortfolio)

        const decision = await applyAllocationEdit({
            portfolioId,
            allocations: { XLM: 70, USDC: 30 },
            expectedVersion: 1,
            storage: mockStorage,
        })

        expect(decision.result).toBe('committed')
        expect(decision.applied).toBe(true)
        expect(decision.committedVersion).toBe(2)
        expect(decision.executionState).toBe('idle')
        expect(decision.portfolio?.allocations).toEqual({ XLM: 70, USDC: 30 })
        expect(decision.portfolio?.version).toBe(2)
        expect(mockStorage.getCurrent()?.allocations).toEqual({ XLM: 70, USDC: 30 })
        expect(mockStorage.getCurrent()?.version).toBe(2)
    })

    it('rejects allocation edit during active rebalance and documents executionState=rebalancing without mutating state', async () => {
        const mockStorage = createMockStorage(initialPortfolio)

        // Simulate active rebalance in flight
        markRebalanceActive(portfolioId, { version: 1, trigger: 'manual' })
        expect(isRebalanceActiveSync(portfolioId)).toBe(true)
        expect(await isRebalanceActive(portfolioId)).toBe(true)
        expect(await getRebalanceExecutionState(portfolioId)).toBe(2 !== 2 ? 'idle' : 'rebalancing')

        const decision = await applyAllocationEdit({
            portfolioId,
            allocations: { XLM: 50, USDC: 50 },
            expectedVersion: 1,
            storage: mockStorage,
        })

        expect(decision.result).toBe('conflict_rebalancing')
        expect(decision.applied).toBe(false)
        expect(decision.committedVersion).toBe(1)
        expect(decision.executionState).toBe('rebalancing')
        expect(decision.reason).toContain('actively rebalancing')
        // Verify underlying storage was untouched
        expect(mockStorage.getCurrent()?.allocations).toEqual({ XLM: 60, USDC: 40 })
        expect(mockStorage.getCurrent()?.version).toBe(1)
        expect(mockStorage.updatePortfolio).not.toHaveBeenCalled()
    })

    it('rejects allocation edit with stale expectedVersion after rebalance advances committed version', async () => {
        // Rebalance completed and bumped portfolio to version 2
        const rebalancedPortfolio: Portfolio = {
            ...initialPortfolio,
            version: 2,
            lastRebalance: '2026-10-22T00:05:00.000Z',
        }
        const mockStorage = createMockStorage(rebalancedPortfolio)

        // Mark rebalance completed
        markRebalanceInactive(portfolioId, { status: 'completed', version: 2 })

        // User submits edit targeting stale version 1
        const decision = await applyAllocationEdit({
            portfolioId,
            allocations: { XLM: 80, USDC: 20 },
            expectedVersion: 1,
            storage: mockStorage,
        })

        expect(decision.result).toBe('conflict_version')
        expect(decision.applied).toBe(false)
        expect(decision.committedVersion).toBe(2)
        expect(decision.executionState).toBe('completed')
        expect(decision.reason).toContain('expected version 1, but committed version is 2')
        // Storage unchanged
        expect(mockStorage.getCurrent()?.version).toBe(2)
        expect(mockStorage.getCurrent()?.allocations).toEqual({ XLM: 60, USDC: 40 })
    })

    it('allows sequential allocation edit with matching expectedVersion after rebalance completion', async () => {
        const rebalancedPortfolio: Portfolio = {
            ...initialPortfolio,
            version: 2,
            lastRebalance: '2026-10-22T00:05:00.000Z',
        }
        const mockStorage = createMockStorage(rebalancedPortfolio)
        markRebalanceInactive(portfolioId, { status: 'completed', version: 2 })

        // User fetches fresh state and submits with expectedVersion: 2
        const decision = await applyAllocationEdit({
            portfolioId,
            allocations: { XLM: 50, USDC: 50 },
            expectedVersion: 2,
            storage: mockStorage,
        })

        expect(decision.result).toBe('committed')
        expect(decision.applied).toBe(true)
        expect(decision.committedVersion).toBe(3)
        expect(decision.executionState).toBe('idle')
        expect(mockStorage.getCurrent()?.version).toBe(3)
        expect(mockStorage.getCurrent()?.allocations).toEqual({ XLM: 50, USDC: 50 })
    })

    it('rejects invalid allocation weights (sum != 100%) with stable validation_error result', async () => {
        const mockStorage = createMockStorage(initialPortfolio)

        const decision = await applyAllocationEdit({
            portfolioId,
            allocations: { XLM: 50, USDC: 40 }, // sums to 90%
            expectedVersion: 1,
            storage: mockStorage,
        })

        expect(decision.result).toBe('validation_error')
        expect(decision.applied).toBe(false)
        expect(decision.committedVersion).toBe(1)
        expect(decision.executionState).toBe('idle')
        expect(decision.reason).toContain('must sum to 100%')
        expect(mockStorage.updatePortfolio).not.toHaveBeenCalled()
    })

    it('rejects empty allocation dictionary with validation_error result', async () => {
        const mockStorage = createMockStorage(initialPortfolio)

        const decision = await applyAllocationEdit({
            portfolioId,
            allocations: {},
            expectedVersion: 1,
            storage: mockStorage,
        })

        expect(decision.result).toBe('validation_error')
        expect(decision.applied).toBe(false)
        expect(decision.committedVersion).toBe(1)
        expect(decision.reason).toContain('at least 1 asset')
    })

    it('rejects allocations exceeding maximum asset limit (> 10 assets)', async () => {
        const mockStorage = createMockStorage(initialPortfolio)
        const excessiveAllocations: Record<string, number> = {}
        for (let i = 1; i <= 11; i++) {
            excessiveAllocations[`ASSET${i}`] = 100 / 11
        }

        const decision = await applyAllocationEdit({
            portfolioId,
            allocations: excessiveAllocations,
            expectedVersion: 1,
            storage: mockStorage,
        })

        expect(decision.result).toBe('validation_error')
        expect(decision.applied).toBe(false)
        expect(decision.reason).toContain('cannot exceed 10 assets')
    })

    it('returns not_found when portfolio does not exist', async () => {
        const mockStorage = createMockStorage(undefined)

        const decision = await applyAllocationEdit({
            portfolioId: 'non-existent-id',
            allocations: { XLM: 50, USDC: 50 },
            expectedVersion: 1,
            storage: mockStorage,
        })

        expect(decision.result).toBe('not_found')
        expect(decision.applied).toBe(false)
        expect(decision.committedVersion).toBe(-1)
        expect(decision.reason).toContain('not found')
    })
})

describe('SPR-2026-156 — Storage Layer Guard: portfolioStorage and databaseService', () => {
    const portfolioId = 'portfolio-storage-guard-test'
    const samplePortfolio: Portfolio = {
        id: portfolioId,
        userAddress: 'GUSER2222222222222222222222222222222222222222222222222222222',
        allocations: { XLM: 50, USDC: 50 },
        threshold: 5,
        version: 1,
        createdAt: '2026-10-22T00:00:00.000Z',
    }

    beforeEach(() => {
        resetRebalanceStateTracker()
    })

    it('portfolioStorage.updatePortfolio throws ConflictError with executionState=rebalancing when active', async () => {
        const id = portfolioStorage.createPortfolio(
            samplePortfolio.userAddress,
            samplePortfolio.allocations,
            samplePortfolio.threshold
        )
        markRebalanceActive(id)

        expect(() => {
            portfolioStorage.updatePortfolio(id, { allocations: { XLM: 80, USDC: 20 } }, 1)
        }).toThrow(ConflictError)

        try {
            await portfolioStorage.updatePortfolio(id, { allocations: { XLM: 80, USDC: 20 } }, 1)
        } catch (err) {
            expect(err).toBeInstanceOf(ConflictError)
            const conflict = err as ConflictError
            expect(conflict.executionState).toBe('rebalancing')
            expect(conflict.result).toBe('conflict_rebalancing')
            expect(conflict.currentVersion).toBe(1)
        }
    })

    it('portfolioStorage.editAllocations returns structured decision without throwing', async () => {
        const id = portfolioStorage.createPortfolio(
            samplePortfolio.userAddress,
            samplePortfolio.allocations,
            samplePortfolio.threshold
        )
        markRebalanceActive(id)

        const decision = await portfolioStorage.editAllocations(
            id,
            { XLM: 80, USDC: 20 },
            1
        )

        expect(decision.result).toBe('conflict_rebalancing')
        expect(decision.applied).toBe(false)
        expect(decision.committedVersion).toBe(1)
        expect(decision.executionState).toBe('rebalancing')
    })

    it('databaseService.updatePortfolio throws ConflictError with executionState=rebalancing when active', () => {
        const id = databaseService.createPortfolio(
            samplePortfolio.userAddress,
            samplePortfolio.allocations,
            samplePortfolio.threshold
        )
        markRebalanceActive(id)

        expect(() => {
            databaseService.updatePortfolio(id, { allocations: { XLM: 70, USDC: 30 } }, 1)
        }).toThrow(ConflictError)

        try {
            databaseService.updatePortfolio(id, { allocations: { XLM: 70, USDC: 30 } }, 1)
        } catch (err) {
            expect(err).toBeInstanceOf(ConflictError)
            const conflict = err as ConflictError
            expect(conflict.executionState).toBe('rebalancing')
            expect(conflict.result).toBe('conflict_rebalancing')
        }
    })
})

describe('SPR-2026-156 — HTTP API Boundary: /api/portfolio/:id/allocations and /api/portfolio/:id', () => {
    let app: express.Express
    const portfolioId = 'portfolio-http-test-123'
    let currentPortfolio: Portfolio

    beforeEach(async () => {
        resetRebalanceStateTracker()
        currentPortfolio = {
            id: portfolioId,
            userAddress: 'GUSER3333333333333333333333333333333333333333333333333333333',
            allocations: { XLM: 50, USDC: 50 },
            threshold: 5,
            version: 1,
            createdAt: '2026-10-22T00:00:00.000Z',
        }

        vi.spyOn(portfolioStorage, 'getPortfolio').mockImplementation(async (id: string) => {
            if (id === portfolioId) return { ...currentPortfolio }
            return undefined
        })
        vi.spyOn(portfolioStorage, 'updatePortfolio').mockImplementation(async (id: string, updates: Partial<Portfolio>, expectedVersion?: number) => {
            if (id !== portfolioId) return false
            if (expectedVersion !== undefined && currentPortfolio.version !== expectedVersion) {
                throw new ConflictError(
                    `Version conflict: expected ${expectedVersion}, got ${currentPortfolio.version}`,
                    currentPortfolio.version
                )
            }
            currentPortfolio = {
                ...currentPortfolio,
                ...updates,
                version: (currentPortfolio.version ?? 1) + 1,
            }
            return true
        })

        const { portfoliosRouter } = await import('../api/portfolios.routes.js')
        app = express()
        app.use(express.json())
        app.use('/api', portfoliosRouter)
    })

    it('PUT /api/portfolio/:id/allocations returns 200 with committedVersion, executionState=idle, and result=committed', async () => {
        const res = await request(app)
            .put(`/api/portfolio/${portfolioId}/allocations`)
            .send({
                allocations: { XLM: 60, USDC: 40 },
                version: 1,
            })
            .expect(200)

        expect(res.body.success).toBe(true)
        expect(res.body.data.committedVersion).toBe(2)
        expect(res.body.data.executionState).toBe('idle')
        expect(res.body.data.result).toBe('committed')
        expect(res.body.data.decision.applied).toBe(true)
        expect(res.body.data.decision.committedVersion).toBe(2)
        expect(res.body.data.portfolio.allocations).toEqual({ XLM: 60, USDC: 40 })
    })

    it('PUT /api/portfolio/:id/allocations returns 409 when rebalance is in-flight with executionState=rebalancing and result=conflict_rebalancing', async () => {
        markRebalanceActive(portfolioId)

        const res = await request(app)
            .put(`/api/portfolio/${portfolioId}/allocations`)
            .send({
                allocations: { XLM: 70, USDC: 30 },
                version: 1,
            })
            .expect(409)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('CONFLICT')
        expect(res.body.error.details.committedVersion).toBe(1)
        expect(res.body.error.details.executionState).toBe('rebalancing')
        expect(res.body.error.details.result).toBe('conflict_rebalancing')
        expect(res.body.error.details.decision.applied).toBe(false)
    })

    it('PUT /api/portfolio/:id/allocations returns 409 when expectedVersion is stale after rebalance bump', async () => {
        currentPortfolio.version = 2
        markRebalanceInactive(portfolioId, { status: 'completed', version: 2 })

        const res = await request(app)
            .put(`/api/portfolio/${portfolioId}/allocations`)
            .send({
                allocations: { XLM: 70, USDC: 30 },
                version: 1, // Stale version
            })
            .expect(409)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('CONFLICT')
        expect(res.body.error.details.committedVersion).toBe(2)
        expect(res.body.error.details.result).toBe('conflict_version')
    })

    it('PUT /api/portfolio/:id/allocations returns 422 when allocations do not sum to 100%', async () => {
        const res = await request(app)
            .put(`/api/portfolio/${portfolioId}/allocations`)
            .send({
                allocations: { XLM: 50, USDC: 20 },
                version: 1,
            })
            .expect(422)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('PUT /api/portfolio/:id/allocations returns 404 for non-existent portfolio', async () => {
        const res = await request(app)
            .put('/api/portfolio/unknown-non-existent-id/allocations')
            .send({
                allocations: { XLM: 50, USDC: 50 },
                version: 1,
            })
            .expect(404)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('NOT_FOUND')
        expect(res.body.error.details.result).toBe('not_found')
    })

    it('PUT /api/portfolio/:id documents committedVersion, executionState, and result when editing allocations', async () => {
        const res = await request(app)
            .put(`/api/portfolio/${portfolioId}`)
            .send({
                allocations: { XLM: 65, USDC: 35 },
                version: 1,
            })
            .expect(200)

        expect(res.body.success).toBe(true)
        expect(res.body.data.committedVersion).toBe(2)
        expect(res.body.data.executionState).toBe('idle')
        expect(res.body.data.result).toBe('committed')
        expect(res.body.data.portfolio.allocations).toEqual({ XLM: 65, USDC: 35 })
    })

    it('PUT /api/portfolio/:id returns 409 with executionState=rebalancing when rebalance is active', async () => {
        markRebalanceActive(portfolioId)

        const res = await request(app)
            .put(`/api/portfolio/${portfolioId}`)
            .send({
                allocations: { XLM: 65, USDC: 35 },
                version: 1,
            })
            .expect(409)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('CONFLICT')
        expect(res.body.error.details.executionState).toBe('rebalancing')
        expect(res.body.error.details.result).toBe('conflict_rebalancing')
        expect(res.body.error.details.committedVersion).toBe(1)
    })
})
