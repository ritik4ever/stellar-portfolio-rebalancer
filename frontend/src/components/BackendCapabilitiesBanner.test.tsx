import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import BackendCapabilitiesBanner from './BackendCapabilitiesBanner'
import type { CapabilityNotice } from '../hooks/useReadinessReport'

vi.mock('../hooks/queries/useReadinessQuery', () => ({
    useReadinessQuery: vi.fn(),
}))

import { useReadinessQuery } from '../hooks/queries/useReadinessQuery'

afterEach(cleanup)

const mockQuery = useReadinessQuery as unknown as ReturnType<typeof vi.fn>

function mockReturn(overrides: Partial<ReturnType<typeof useReadinessQuery>> = {}) {
    mockQuery.mockReturnValue({
        notices: [],
        loadError: false,
        loading: false,
        report: null,
        refresh: vi.fn(),
        ...overrides,
    })
}

function notice(id: string, kind: CapabilityNotice['kind'] = 'disabled', text = 'Some issue.'): CapabilityNotice {
    return { id, kind, text }
}

describe('BackendCapabilitiesBanner', () => {
    afterEach(() => {
        mockQuery.mockReset()
    })

    it('renders nothing when no notices and no error', () => {
        mockReturn()
        const { container } = render(<BackendCapabilitiesBanner />)
        expect(container.firstChild).toBeNull()
    })

    it('renders load-error message when loadError is true and no notices', () => {
        mockReturn({ loadError: true, notices: [] })
        render(<BackendCapabilitiesBanner />)
        expect(screen.getByRole('status')).toHaveTextContent(/could not load backend service status/i)
    })

    it('renders notice text', () => {
        mockReturn({ notices: [notice('database', 'limited', 'DB is down.')] })
        render(<BackendCapabilitiesBanner />)
        expect(screen.getByText(/DB is down\./)).toBeInTheDocument()
    })

    it('attaches a doc link for database notice', () => {
        mockReturn({ notices: [notice('database', 'limited')] })
        render(<BackendCapabilitiesBanner />)
        const link = screen.getByRole('link', { name: /database setup/i })
        expect(link).toHaveAttribute('href', expect.stringContaining('#database-setup'))
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('attaches a doc link for queue-workers notice', () => {
        mockReturn({ notices: [notice('queue-workers')] })
        render(<BackendCapabilitiesBanner />)
        const link = screen.getByRole('link', { name: /redis \/ worker setup/i })
        expect(link).toHaveAttribute('href', expect.stringContaining('CONTRIBUTING'))
    })

    it('attaches a doc link for indexer notice', () => {
        mockReturn({ notices: [notice('indexer')] })
        render(<BackendCapabilitiesBanner />)
        const link = screen.getByRole('link', { name: /environment setup/i })
        expect(link).toHaveAttribute('href', expect.stringContaining('ENVIRONMENT'))
    })

    it('attaches a doc link for auto-rebalancer notice', () => {
        mockReturn({ notices: [notice('auto-rebalancer')] })
        render(<BackendCapabilitiesBanner />)
        const link = screen.getByRole('link', { name: /environment setup/i })
        expect(link).toBeInTheDocument()
    })

    it('renders multiple notices each with their own link', () => {
        const notices = [notice('database', 'limited'), notice('queue-workers')]
        mockReturn({ notices })
        const { container } = render(<BackendCapabilitiesBanner />)
        const banner = container.querySelector('[role="status"]')!
        expect(within(banner as HTMLElement).getByRole('link', { name: /database setup/i })).toBeInTheDocument()
        expect(within(banner as HTMLElement).getByRole('link', { name: /redis \/ worker setup/i })).toBeInTheDocument()
    })

    it('applies top-14 class when belowRealtimeBar is true', () => {
        mockReturn({ notices: [notice('database', 'limited')] })
        render(<BackendCapabilitiesBanner belowRealtimeBar />)
        expect(screen.getByRole('status').className).toContain('top-14')
    })

    it('applies top-0 class when belowRealtimeBar is false', () => {
        mockReturn({ notices: [notice('database', 'limited')] })
        render(<BackendCapabilitiesBanner />)
        expect(screen.getByRole('status').className).toContain('top-0')
    })

    it('uses amber styling when any notice is limited', () => {
        mockReturn({ notices: [notice('database', 'limited')] })
        render(<BackendCapabilitiesBanner />)
        expect(screen.getByRole('status').className).toContain('amber')
    })

    it('uses slate styling when all notices are disabled', () => {
        mockReturn({ notices: [notice('queue-workers', 'disabled')] })
        render(<BackendCapabilitiesBanner />)
        expect(screen.getByRole('status').className).not.toContain('amber')
    })

    it('updates banner after a simulated capability change on subsequent poll', () => {
        mockReturn({ notices: [notice('database', 'limited', 'Initial issue.')] })
        const { unmount } = render(<BackendCapabilitiesBanner />)
        expect(screen.getByText(/Initial issue\./)).toBeInTheDocument()
        unmount()

        mockQuery.mockReturnValue({
            notices: [notice('database', 'limited', 'Updated issue.')],
            loadError: false,
            loading: false,
            report: null,
            refresh: vi.fn(),
        })
        render(<BackendCapabilitiesBanner />)
        expect(screen.getByText(/Updated issue\./)).toBeInTheDocument()
    })
})
