import { render, screen, cleanup } from '@testing-library/react'
import AllocationForm from './AllocationForm'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ContractCapabilityReport } from '../lib/contractCapabilities'

describe('AllocationForm', () => {
    afterEach(() => {
        cleanup()
    })

    const defaultAllocations = [
        { asset: 'XLM', percentage: 60 },
        { asset: 'USDC', percentage: 40 },
    ]

    const fullyCapableReport: ContractCapabilityReport = {
        severity: 'ok',
        title: 'OK',
        message: 'OK',
        writesEnabled: true,
        expectedSchemaVersion: 1,
        availableMethods: ['update_allocations'],
    }

    const uncapableReport: ContractCapabilityReport = {
        severity: 'warning',
        title: 'Warning',
        message: 'Warning',
        writesEnabled: true,
        expectedSchemaVersion: 1,
        availableMethods: [], // Missing update_allocations
    }

    it('renders and allows editing when fully capable', () => {
        render(<AllocationForm allocations={defaultAllocations} onChange={vi.fn()} contractCapabilityReport={fullyCapableReport} />)
        const inputs = screen.getAllByRole('spinbutton')
        expect(inputs[0]).not.toBeDisabled()
        expect(screen.getByRole('button', { name: /Submit Portfolio/i })).not.toBeDisabled()
    })

    it('disables controls and shows tooltip when capability is missing', () => {
        render(<AllocationForm allocations={defaultAllocations} onChange={vi.fn()} contractCapabilityReport={uncapableReport} />)
        
        const wrapper = screen.getByTitle(/Block the write; keep the existing allocations visible read-only/i)
        expect(wrapper).toBeInTheDocument()
        expect(screen.getByTestId('update-allocations-disabled-reason')).toHaveTextContent(/read-only/i)

        const inputs = screen.getAllByRole('spinbutton')
        expect(inputs[0]).toBeDisabled()
        expect(screen.getByRole('button', { name: /Submit Portfolio/i })).toBeDisabled()
    })

    it('disables controls when the capabilities() flag is false', () => {
        const flagFalseReport: ContractCapabilityReport = {
            ...fullyCapableReport,
            capabilities: { update_allocations: false },
        }
        render(<AllocationForm allocations={defaultAllocations} onChange={vi.fn()} contractCapabilityReport={flagFalseReport} />)

        expect(screen.getByTestId('update-allocations-disabled-reason')).toBeInTheDocument()
        expect(screen.getAllByRole('spinbutton')[0]).toBeDisabled()
        expect(screen.getByRole('button', { name: /Submit Portfolio/i })).toBeDisabled()
    })

    it('handles a missing capabilities() field on older contracts without crashing', () => {
        const olderContract: ContractCapabilityReport = {
            severity: 'warning',
            title: 'Legacy',
            message: 'No capabilities() field',
            writesEnabled: true,
            expectedSchemaVersion: 1,
            availableMethods: [],
            capabilities: undefined,
        }
        render(<AllocationForm allocations={defaultAllocations} onChange={vi.fn()} contractCapabilityReport={olderContract} />)

        expect(screen.getByTestId('update-allocations-disabled-reason')).toBeInTheDocument()
        expect(screen.getAllByRole('spinbutton')[0]).toBeDisabled()
    })

    it('does not crash when the capability report is null', () => {
        render(<AllocationForm allocations={defaultAllocations} onChange={vi.fn()} contractCapabilityReport={null} />)
        expect(screen.getAllByRole('spinbutton')[0]).toBeDisabled()
        expect(screen.getByTestId('update-allocations-disabled-reason')).toBeInTheDocument()
    })

    it('remains enabled if capability report is undefined', () => {
        render(<AllocationForm allocations={defaultAllocations} onChange={vi.fn()} />)
        const inputs = screen.getAllByRole('spinbutton')
        expect(inputs[0]).not.toBeDisabled()
    })
})
