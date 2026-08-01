import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import PriceAlerts from './PriceAlerts'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    length: 0,
    key: () => null,
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'priceAlerts.title': 'Price Alerts',
        'priceAlerts.subtitle': 'Set up alerts for price movements',
        'priceAlerts.createAlert': 'Create Alert',
        'priceAlerts.asset': 'Asset',
        'priceAlerts.alertType': 'Alert Type',
        'priceAlerts.email': 'Email',
        'priceAlerts.webhook': 'Webhook',
        'priceAlerts.upperThreshold': 'Upper Threshold',
        'priceAlerts.lowerThreshold': 'Lower Threshold',
        'priceAlerts.webhookUrl': 'Webhook URL',
        'priceAlerts.cancel': 'Cancel',
        'priceAlerts.save': 'Save',
        'priceAlerts.editAlert': 'Edit Alert',
        'priceAlerts.noAlerts': 'No alerts yet',
        'priceAlerts.distance': 'Distance',
        'priceAlerts.currentPrice': 'Current Price',
        'priceAlerts.validation.positivePrice': 'Must be a positive number',
        'priceAlerts.validation.validUrl': 'Please enter a valid URL',
      }
      return map[key] || key
    },
  }),
}))

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorageMock.clear()
})

describe('PriceAlerts', () => {
  it('renders connect prompt when no publicKey', () => {
    render(<PriceAlerts publicKey={null} />)
    expect(screen.getByText('Connect wallet to manage price alerts')).toBeTruthy()
  })

  it('renders title when connected', () => {
    render(<PriceAlerts publicKey="test-key" />)
    expect(screen.getByText('Price Alerts')).toBeTruthy()
  })

  it('shows AND/OR toggle in the form', () => {
    render(<PriceAlerts publicKey="test-key" />)
    fireEvent.click(screen.getByText('Create Alert'))
    expect(screen.getByText('AND (all conditions)')).toBeTruthy()
    expect(screen.getByText('OR (any condition)')).toBeTruthy()
  })

  it('allows creating a multi-condition AND alert', async () => {
    render(<PriceAlerts publicKey="test-key" />)
    fireEvent.click(screen.getByText('Create Alert'))

    const upperInputs = screen.getAllByPlaceholderText('Upper (optional)')
    const lowerInputs = screen.getAllByPlaceholderText('Lower (optional)')
    fireEvent.change(upperInputs[0], { target: { value: '0.5' } })
    fireEvent.change(lowerInputs[0], { target: { value: '0.1' } })

    const emailInput = screen.getByPlaceholderText('your@email.com')
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })

    fireEvent.click(screen.getByText('Add condition'))
    const secondUpper = screen.getAllByPlaceholderText('Upper (optional)')[1]
    fireEvent.change(secondUpper, { target: { value: '5000' } })

    fireEvent.click(screen.getByText('Save'))

    await vi.waitFor(() => {
      const saved = localStorage.getItem('priceAlerts_test-key')
      expect(saved).toBeTruthy()
      const parsed = JSON.parse(saved!)
      expect(parsed.length).toBe(1)
      expect(parsed[0].conditions.length).toBe(2)
      expect(parsed[0].logic).toBe('AND')
    })
  })

  it('allows creating a multi-condition OR alert', async () => {
    render(<PriceAlerts publicKey="test-key" />)
    fireEvent.click(screen.getByText('Create Alert'))

    fireEvent.click(screen.getByText('OR (any condition)'))

    const upperInputs = screen.getAllByPlaceholderText('Upper (optional)')
    fireEvent.change(upperInputs[0], { target: { value: '0.5' } })

    const emailInput = screen.getByPlaceholderText('your@email.com')
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })

    fireEvent.click(screen.getByText('Add condition'))
    const secondUpper = screen.getAllByPlaceholderText('Upper (optional)')[1]
    fireEvent.change(secondUpper, { target: { value: '50000' } })

    fireEvent.click(screen.getByText('Save'))

    await vi.waitFor(() => {
      const saved = localStorage.getItem('priceAlerts_test-key')
      expect(saved).toBeTruthy()
      const parsed = JSON.parse(saved!)
      expect(parsed.length).toBe(1)
      expect(parsed[0].conditions.length).toBe(2)
      expect(parsed[0].logic).toBe('OR')
    })
  })

  it('displays combined condition summary for AND alert', () => {
    render(<PriceAlerts publicKey="test-key" />)
    fireEvent.click(screen.getByText('Create Alert'))

    const upperInputs = screen.getAllByPlaceholderText('Upper (optional)')
    fireEvent.change(upperInputs[0], { target: { value: '0.5' } })
    const lowerInputs = screen.getAllByPlaceholderText('Lower (optional)')
    fireEvent.change(lowerInputs[0], { target: { value: '0.1' } })

    fireEvent.click(screen.getByText('Save'))

    expect(screen.getByText(/XLM/)).toBeTruthy()
  })
})
