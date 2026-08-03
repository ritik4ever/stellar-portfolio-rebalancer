import { render, screen } from '@testing-library/react'
import AllocationForm from './AllocationForm'
import { describe, it, expect, vi } from 'vitest'
import { ContractCapabilityReport } from '../lib/contractCapabilities'

describe('AllocationForm', () => {
    const defaultAllocations = [
        { asset: 'XLM', percentage: 60 },
        { asset: 'USDC', percentage: 40 },
    ]

    const fullyCapableReport: ContractCapabilityReport = {
        severity: 'ok',
        title: 'OK',
        message: 'All capabilities available',
        writesEnabled: true,
        expectedSchemaVersion: 1,
        availableMethods: ['update_allocations'],
    }

    const uncapableReport: ContractCapabilityReport = {
        severity: 'warning',
        title: 'Warning',
        message: 'Missing capabilities',
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

        const inputs = screen.getAllByRole('spinbutton')
        expect(inputs[0]).toBeDisabled()
        expect(screen.getByRole('button', { name: /Submit Portfolio/i })).toBeDisabled()
    })

    it('remains enabled if capability report is undefined', () => {
        render(<AllocationForm allocations={defaultAllocations} onChange={vi.fn()} />)
        const inputs = screen.getAllByRole('spinbutton')
        expect(inputs[0]).not.toBeDisabled()
    })
})
