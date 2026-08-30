import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Landing from './Landing'

vi.mock('./ThemeToggle', () => ({
    default: () => <div data-testid="theme-toggle" />,
}))

vi.mock('./WalletSelector', () => ({
    WalletSelector: () => <div>Wallet selector</div>,
}))

vi.mock('../config/api', () => ({
    api: { get: vi.fn().mockResolvedValue({ accepted: true }) },
    ENDPOINTS: { CONSENT_STATUS: '/consent' },
}))

describe('Landing', () => {
    it('renders how-it-works and trust sections', () => {
        render(
            <Landing
                onNavigate={vi.fn()}
                onConnectWallet={vi.fn().mockResolvedValue(undefined)}
                isConnecting={false}
                publicKey={null}
            />,
        )
        expect(screen.getByRole('heading', { name: /how it works/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /built for transparency/i })).toBeInTheDocument()
        expect(screen.getByText(/Sentry, Prometheus/i)).toBeInTheDocument()
    })
})
