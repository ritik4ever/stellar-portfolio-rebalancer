import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import DeveloperDrawer, { isDeveloperDrawerUnlocked, unlockDeveloperDrawer, computeCapabilityDiff } from './DeveloperDrawer'
import type { ContractCapabilityReport } from '../lib/contractCapabilities'

vi.mock('../config/api', async () => {
    const actual = await vi.importActual<typeof import('../config/api')>('../config/api')
    return {
        ...actual,
        testBrowserPrices: vi.fn(async () => true),
    }
})

vi.mock('../services/browserPriceService', () => ({
    browserPriceService: {
        getCacheInspectorEntries: vi.fn(() => [
            {
                key: 'prices',
                assetCount: 2,
                ageMs: 1000,
                ttlRemainingMs: 59000,
                resolutionHint: 'cached_only',
                sources: ['reflector'],
                cachedAtMs: Date.now() - 1000,
            },
        ]),
        getCurrentPrices: vi.fn(async () => ({ prices: {}, feedMeta: {} })),
        clearCache: vi.fn(),
    },
}))

vi.mock('./NotificationTest', () => ({
    NotificationTest: () => <div>Notification test panel</div>,
}))

describe('DeveloperDrawer', () => {
    beforeEach(() => {
        sessionStorage.clear()
        vi.restoreAllMocks()
    })

    it('opens from the keyboard shortcut after unlock', () => {
        unlockDeveloperDrawer()
        render(<DeveloperDrawer publicKey="GTEST123" />)

        fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true })
        expect(screen.getByRole('dialog', { name: /developer tools/i })).toBeTruthy()
        expect(screen.getByText(/browser price cache/i)).toBeTruthy()
        expect(screen.getByText('Notification test panel')).toBeTruthy()
    })

    it('starts locked outside development until explicitly unlocked', () => {
        expect(isDeveloperDrawerUnlocked()).toBe(import.meta.env.DEV)
    })

    describe('computeCapabilityDiff', () => {
        it('correctly identifies added methods', () => {
            const previous: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Previous',
                message: 'Previous state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['get_portfolio', 'create_portfolio'],
            }

            const current: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Current',
                message: 'Current state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['get_portfolio', 'create_portfolio', 'deposit', 'withdraw'],
            }

            const diff = computeCapabilityDiff(current, previous)

            expect(diff).toHaveLength(4)
            expect(diff.find((d) => d.method === 'deposit')?.type).toBe('added')
            expect(diff.find((d) => d.method === 'withdraw')?.type).toBe('added')
            expect(diff.find((d) => d.method === 'get_portfolio')?.type).toBe('unchanged')
            expect(diff.find((d) => d.method === 'create_portfolio')?.type).toBe('unchanged')
        })

        it('correctly identifies removed methods', () => {
            const previous: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Previous',
                message: 'Previous state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['get_portfolio', 'create_portfolio', 'deposit', 'withdraw'],
            }

            const current: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Current',
                message: 'Current state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['get_portfolio', 'create_portfolio'],
            }

            const diff = computeCapabilityDiff(current, previous)

            expect(diff).toHaveLength(4)
            expect(diff.find((d) => d.method === 'deposit')?.type).toBe('removed')
            expect(diff.find((d) => d.method === 'withdraw')?.type).toBe('removed')
            expect(diff.find((d) => d.method === 'get_portfolio')?.type).toBe('unchanged')
            expect(diff.find((d) => d.method === 'create_portfolio')?.type).toBe('unchanged')
        })

        it('handles mixed added and removed methods', () => {
            const previous: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Previous',
                message: 'Previous state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['get_portfolio', 'create_portfolio', 'deposit'],
            }

            const current: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Current',
                message: 'Current state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['get_portfolio', 'create_portfolio', 'withdraw'],
            }

            const diff = computeCapabilityDiff(current, previous)

            expect(diff).toHaveLength(3)
            expect(diff.find((d) => d.method === 'deposit')?.type).toBe('removed')
            expect(diff.find((d) => d.method === 'withdraw')?.type).toBe('added')
            expect(diff.find((d) => d.method === 'get_portfolio')?.type).toBe('unchanged')
        })

        it('returns all methods as unchanged when no previous snapshot', () => {
            const current: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Current',
                message: 'Current state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['get_portfolio', 'create_portfolio', 'deposit'],
            }

            const diff = computeCapabilityDiff(current, null)

            expect(diff).toHaveLength(3)
            expect(diff.every((d) => d.type === 'unchanged')).toBe(true)
        })

        it('sorts diffs by type then method name', () => {
            const previous: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Previous',
                message: 'Previous state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['create_portfolio', 'deposit'],
            }

            const current: ContractCapabilityReport = {
                severity: 'ok',
                title: 'Current',
                message: 'Current state',
                writesEnabled: true,
                expectedSchemaVersion: 1,
                availableMethods: ['get_portfolio', 'withdraw'],
            }

            const diff = computeCapabilityDiff(current, previous)

            // Should be sorted: added (get_portfolio, withdraw), removed (create_portfolio, deposit)
            expect(diff[0].type).toBe('added')
            expect(diff[1].type).toBe('added')
            expect(diff[2].type).toBe('removed')
            expect(diff[3].type).toBe('removed')
            expect(diff[0].method).toBe('get_portfolio')
            expect(diff[1].method).toBe('withdraw')
        })
    })
})
