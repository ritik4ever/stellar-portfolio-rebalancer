import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import BootDiagnosticsPanel from './BootDiagnosticsPanel'
import type { BootCheck } from '../app/walletBoot'

function makeCheck(overrides: Partial<BootCheck> & { id: string }): BootCheck {
    return { label: '', status: 'passed', message: undefined, ...overrides }
}

describe('BootDiagnosticsPanel', () => {
    afterEach(cleanup)
    it('renders all checks with status labels', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'wallet', label: 'Wallet extension', status: 'passed', message: 'Detected' }),
            makeCheck({ id: 'api', label: 'API reachability', status: 'failed', message: 'Unreachable' }),
        ]
        render(<BootDiagnosticsPanel checks={checks} />)

        expect(screen.getByText('Wallet extension')).toBeTruthy()
        expect(screen.getByText('API reachability')).toBeTruthy()
        expect(screen.getByText('Passed')).toBeTruthy()
        expect(screen.getByText('Failed')).toBeTruthy()
        expect(screen.getByText('Detected')).toBeTruthy()
        expect(screen.getByText('Unreachable')).toBeTruthy()
    })

    it('shows the header Startup checks', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'passed' }),
        ]
        render(<BootDiagnosticsPanel checks={checks} />)
        expect(screen.getByText('Startup checks')).toBeTruthy()
    })

    it('renders nothing when checks array is empty and not loading', () => {
        const { container } = render(<BootDiagnosticsPanel checks={[]} />)
        expect(container.innerHTML).toBe('')
    })

    it('shows Running… when a check is loading', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'loading' }),
        ]
        render(<BootDiagnosticsPanel checks={checks} />)
        expect(screen.getByText('Running…')).toBeTruthy()
    })

    it('shows Checking… status label for loading checks', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'loading' }),
        ]
        render(<BootDiagnosticsPanel checks={checks} />)
        expect(screen.getByText('Checking…')).toBeTruthy()
    })

    it('shows retry button when any check failed and onRetry is provided', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'failed' }),
        ]
        const onRetry = vi.fn()
        render(<BootDiagnosticsPanel checks={checks} onRetry={onRetry} />)

        const retryBtn = screen.getByText('Retry checks')
        expect(retryBtn).toBeTruthy()
        fireEvent.click(retryBtn)
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('does not show retry button when all checks passed', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'passed' }),
            makeCheck({ id: 'a', label: 'API', status: 'passed' }),
        ]
        render(<BootDiagnosticsPanel checks={checks} />)
        expect(screen.queryByText('Retry checks')).toBeNull()
    })

    it('does not show retry button when onRetry is not provided', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'failed' }),
        ]
        render(<BootDiagnosticsPanel checks={checks} />)
        expect(screen.queryByText('Retry checks')).toBeNull()
    })

    it('disables retry button while loading', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'loading' }),
            makeCheck({ id: 'a', label: 'API', status: 'failed' }),
        ]
        const onRetry = vi.fn()
        render(<BootDiagnosticsPanel checks={checks} onRetry={onRetry} />)

        const retryBtn = screen.getByText('Retry checks')
        expect(retryBtn).toBeDisabled()
    })

    it('applies custom className', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'passed' }),
        ]
        const { container } = render(<BootDiagnosticsPanel checks={checks} className="custom-class" />)
        const root = container.firstChild as HTMLElement
        expect(root.classList.contains('custom-class')).toBe(true)
    })

    it('sets role="status" for accessibility', () => {
        const checks: BootCheck[] = [
            makeCheck({ id: 'w', label: 'Wallet', status: 'passed' }),
        ]
        const { container } = render(<BootDiagnosticsPanel checks={checks} />)
        const root = container.firstChild as HTMLElement
        expect(root.getAttribute('role')).toBe('status')
    })
})
