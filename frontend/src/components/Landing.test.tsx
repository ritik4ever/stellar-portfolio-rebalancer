import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Landing from './Landing'

afterEach(() => {
    cleanup()
})

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

    it('explains demo mode boundary and switching to a connected wallet when disconnected', () => {
        render(
            <Landing
                onNavigate={vi.fn()}
                onConnectWallet={vi.fn().mockResolvedValue(undefined)}
                isConnecting={false}
                publicKey={null}
            />,
        )

        const demoButton = screen.getByRole('button', { name: 'View Demo' })
        expect(demoButton).toHaveAttribute('aria-describedby', 'landing-mode-boundary-note')
        expect(
            screen.getByText(
                /Demo mode uses a fixed \$10,000 simulated balance \(40% XLM \/ 60% USDC\)\. Connecting a wallet switches to your real on-chain balances without merging demo data\./i,
            ),
        ).toBeInTheDocument()
    })

    it('labels dashboard navigation and separation from demo mode when wallet is connected', () => {
        render(
            <Landing
                onNavigate={vi.fn()}
                onConnectWallet={vi.fn().mockResolvedValue(undefined)}
                isConnecting={false}
                publicKey="GABCD1234567890TEST"
            />,
        )

        expect(screen.queryByRole('button', { name: 'View Demo' })).not.toBeInTheDocument()
        const openDashboardButton = screen.getByRole('button', { name: 'Open Dashboard' })
        expect(openDashboardButton).toHaveAttribute('aria-describedby', 'landing-mode-boundary-note')
        expect(
            screen.getByText(
                /Wallet connected: opening the dashboard loads your real on-chain balances, kept separate from the \$10,000 simulated Demo mode\. Disconnect to return to Demo mode\./i,
            ),
        ).toBeInTheDocument()
    })
})
