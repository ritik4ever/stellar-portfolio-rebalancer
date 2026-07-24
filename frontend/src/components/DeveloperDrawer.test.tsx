import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import DeveloperDrawer, { isDeveloperDrawerUnlocked, unlockDeveloperDrawer } from './DeveloperDrawer'

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
})
