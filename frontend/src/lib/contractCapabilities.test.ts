import { describe, it, expect } from 'vitest'
import {
    canUpdateAllocations,
    readUpdateAllocationsCapabilityFlag,
    blockedWriteFallback,
    type ContractCapabilityReport,
} from './contractCapabilities'

function report(
    overrides: Partial<ContractCapabilityReport> = {},
): ContractCapabilityReport {
    return {
        severity: 'ok',
        title: 'OK',
        message: 'ok',
        writesEnabled: true,
        expectedSchemaVersion: 1,
        availableMethods: ['update_allocations'],
        ...overrides,
    }
}

describe('readUpdateAllocationsCapabilityFlag', () => {
    it('returns true when the flag is present and enabled', () => {
        expect(readUpdateAllocationsCapabilityFlag({ update_allocations: true })).toBe(true)
        expect(readUpdateAllocationsCapabilityFlag({ updateAllocations: true })).toBe(true)
        expect(readUpdateAllocationsCapabilityFlag(true)).toBe(true)
    })

    it('returns false when the flag is present and disabled', () => {
        expect(readUpdateAllocationsCapabilityFlag({ update_allocations: false })).toBe(false)
        expect(readUpdateAllocationsCapabilityFlag(false)).toBe(false)
    })

    it('returns missing for older contracts that omit capabilities()', () => {
        expect(readUpdateAllocationsCapabilityFlag(undefined)).toBe('missing')
        expect(readUpdateAllocationsCapabilityFlag(null)).toBe('missing')
        expect(readUpdateAllocationsCapabilityFlag({})).toBe('missing')
        expect(readUpdateAllocationsCapabilityFlag(0)).toBe('missing')
    })

    it('does not throw on malformed capabilities payloads', () => {
        expect(() => readUpdateAllocationsCapabilityFlag('nope')).not.toThrow()
        expect(() => readUpdateAllocationsCapabilityFlag(['update_allocations'])).not.toThrow()
        expect(readUpdateAllocationsCapabilityFlag('nope')).toBe('missing')
    })
})

describe('canUpdateAllocations', () => {
    it('treats a true capabilities() flag as supported', () => {
        expect(
            canUpdateAllocations(
                report({
                    availableMethods: [],
                    capabilities: { update_allocations: true },
                }),
            ),
        ).toBe(true)
    })

    it('treats a false capabilities() flag as unsupported even if the method is listed', () => {
        expect(
            canUpdateAllocations(
                report({
                    availableMethods: ['update_allocations'],
                    capabilities: { update_allocations: false },
                }),
            ),
        ).toBe(false)
    })

    it('falls back to availableMethods when capabilities() is missing', () => {
        expect(canUpdateAllocations(report({ capabilities: undefined }))).toBe(true)
        expect(
            canUpdateAllocations(
                report({ availableMethods: [], capabilities: undefined }),
            ),
        ).toBe(false)
    })

    it('handles a null report without crashing', () => {
        expect(canUpdateAllocations(null)).toBe(false)
    })
})

describe('blockedWriteFallback for update_allocations', () => {
    it('blocks writes when the capabilities() flag is false', () => {
        const message = blockedWriteFallback(
            report({ capabilities: { update_allocations: false } }),
            'update_allocations',
        )
        expect(message).toMatch(/read-only/i)
    })
})
