import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import BackendCapabilitiesBanner from './BackendCapabilitiesBanner'
import type { CapabilityNotice } from '../hooks/useReadinessReport'

afterEach(cleanup)

const defaultProps = { loadError: false, loading: false, belowRealtimeBar: false }

function notice(id: string, kind: CapabilityNotice['kind'] = 'disabled', text = 'Some issue.'): CapabilityNotice {
    return { id, kind, text }
}

describe('BackendCapabilitiesBanner', () => {
    it('renders nothing when no notices and no error', () => {
        const { container } = render(<BackendCapabilitiesBanner {...defaultProps} notices={[]} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders load-error message when loadError is true and no notices', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} loadError notices={[]} />)
        expect(screen.getByRole('status')).toHaveTextContent(/could not load backend service status/i)
    })

    it('renders notice text', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('database', 'limited', 'DB is down.')]} />)
        expect(screen.getByText(/DB is down\./)).toBeInTheDocument()
    })

    it('attaches a doc link for database notice', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('database', 'limited')]} />)
        const link = screen.getByRole('link', { name: /database setup/i })
        expect(link).toHaveAttribute('href', expect.stringContaining('#database-setup'))
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('attaches a doc link for queue-workers notice', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('queue-workers')]} />)
        const link = screen.getByRole('link', { name: /redis \/ worker setup/i })
        expect(link).toHaveAttribute('href', expect.stringContaining('CONTRIBUTING'))
    })

    it('attaches a doc link for indexer notice', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('indexer')]} />)
        const link = screen.getByRole('link', { name: /environment setup/i })
        expect(link).toHaveAttribute('href', expect.stringContaining('ENVIRONMENT'))
    })

    it('attaches a doc link for auto-rebalancer notice', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('auto-rebalancer')]} />)
        const link = screen.getByRole('link', { name: /environment setup/i })
        expect(link).toBeInTheDocument()
    })

    it('renders multiple notices each with their own link', () => {
        const notices = [notice('database', 'limited'), notice('queue-workers')]
        const { container } = render(<BackendCapabilitiesBanner {...defaultProps} notices={notices} />)
        const banner = container.querySelector('[role="status"]')!
        expect(within(banner as HTMLElement).getByRole('link', { name: /database setup/i })).toBeInTheDocument()
        expect(within(banner as HTMLElement).getByRole('link', { name: /redis \/ worker setup/i })).toBeInTheDocument()
    })

    it('applies top-14 class when belowRealtimeBar is true', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('database', 'limited')]} belowRealtimeBar />)
        expect(screen.getByRole('status').className).toContain('top-14')
    })

    it('applies top-0 class when belowRealtimeBar is false', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('database', 'limited')]} />)
        expect(screen.getByRole('status').className).toContain('top-0')
    })

    it('uses amber styling when any notice is limited', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('database', 'limited')]} />)
        expect(screen.getByRole('status').className).toContain('amber')
    })

    it('uses slate styling when all notices are disabled', () => {
        render(<BackendCapabilitiesBanner {...defaultProps} notices={[notice('queue-workers', 'disabled')]} />)
        expect(screen.getByRole('status').className).not.toContain('amber')
    })
})
