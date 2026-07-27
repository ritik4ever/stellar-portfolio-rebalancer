import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NetworkMismatchBanner } from './NetworkMismatchBanner'

describe('NetworkMismatchBanner', () => {
  it('renders mismatch warning with network labels', () => {
    render(
      <NetworkMismatchBanner
        configuredNetwork="mainnet"
        walletNetwork="testnet"
      />
    )

    expect(screen.getAllByText('Wallet network mismatch')[0]).toBeInTheDocument()
    expect(screen.getAllByText(/Testnet/)[0]).toBeInTheDocument()
    expect(screen.getAllByText(/Mainnet \(Public\)/)[0]).toBeInTheDocument()
  })

  it('renders with unknown wallet network', () => {
    render(
      <NetworkMismatchBanner
        configuredNetwork="testnet"
        walletNetwork={null}
      />
    )

    expect(screen.getAllByText('Wallet network mismatch')[0]).toBeInTheDocument()
  })

  it('calls onDismiss when dismiss button clicked', async () => {
    const onDismiss = vi.fn()
    render(
      <NetworkMismatchBanner
        configuredNetwork="testnet"
        walletNetwork="mainnet"
        onDismiss={onDismiss}
      />
    )

    const [dismissButton] = screen.getAllByLabelText('Dismiss network mismatch warning')
    await userEvent.click(dismissButton)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('includes link to troubleshooting guide', () => {
    render(
      <NetworkMismatchBanner
        configuredNetwork="testnet"
        walletNetwork="mainnet"
      />
    )

    const [link] = screen.getAllByText('Wallet troubleshooting guide')
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toContain('WALLET_TROUBLESHOOTING.md')
  })
})
