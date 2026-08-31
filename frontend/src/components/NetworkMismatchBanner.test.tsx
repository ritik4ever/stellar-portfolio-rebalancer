import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NetworkMismatchBanner } from './NetworkMismatchBanner'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const mockSwitchAdapter = vi.hoisted(() => ({
  name: 'Hana',
  type: 'hana',
  isAvailable: vi.fn(() => true),
  connect: vi.fn(),
  isConnected: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(),
  switchNetwork: vi.fn().mockResolvedValue(undefined),
}))

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

  it('shows manual instructions for wallets without programmatic switch support', () => {
    render(
      <NetworkMismatchBanner
        configuredNetwork="mainnet"
        walletNetwork="testnet"
      />
    )

    const instructions = screen.getAllByText(/Switch your wallet to Mainnet/i)
    expect(instructions.length).toBeGreaterThanOrEqual(1)
  })

  it('shows switch network button for wallets that support programmatic switch', async () => {
    vi.mock('../utils/walletAdapters', async () => {
      const actual = await vi.importActual('../utils/walletAdapters')
      return {
        ...actual,
        getAdapter: vi.fn(() => mockSwitchAdapter),
      }
    })

    render(
      <NetworkMismatchBanner
        configuredNetwork="testnet"
        walletNetwork="mainnet"
        walletType="hana"
      />
    )

    expect(screen.getByText(/Switch to testnet/i)).toBeInTheDocument()
  })

  it('dismisses banner after a successful simulated network switch', async () => {
    const onDismiss = vi.fn()

    vi.mock('../utils/walletAdapters', async () => {
      const actual = await vi.importActual('../utils/walletAdapters')
      return {
        ...actual,
        getAdapter: vi.fn(() => mockSwitchAdapter),
      }
    })

    vi.mock('../utils/networkDetection', async () => {
      const actual = await vi.importActual('../utils/networkDetection')
      return {
        ...actual,
        detectWalletNetwork: vi.fn().mockResolvedValue('testnet'),
      }
    })

    render(
      <NetworkMismatchBanner
        configuredNetwork="testnet"
        walletNetwork="mainnet"
        walletType="hana"
        onDismiss={onDismiss}
      />
    )

    const switchButton = screen.getByText(/Switch to testnet/i)
    await userEvent.click(switchButton)

    await vi.waitFor(() => {
      expect(screen.queryByText('Wallet network mismatch')).not.toBeInTheDocument()
    })
  })
})
