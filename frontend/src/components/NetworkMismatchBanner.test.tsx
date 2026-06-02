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

    expect(screen.getByText('Wallet network mismatch')).toBeDefined()
    expect(screen.getByText(/Testnet/)).toBeDefined()
    expect(screen.getByText(/Mainnet \(Public\)/)).toBeDefined()
  })

  it('renders with unknown wallet network', () => {
    render(
      <NetworkMismatchBanner
        configuredNetwork="testnet"
        walletNetwork={null}
      />
    )

    expect(screen.getByText('Wallet network mismatch')).toBeDefined()
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

    const dismissButton = screen.getByLabelText('Dismiss network mismatch warning')
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

    const link = screen.getByText('Wallet troubleshooting guide')
    expect(link).toBeDefined()
    expect(link.getAttribute('href')).toContain('WALLET_TROUBLESHOOTING.md')
  })
})
