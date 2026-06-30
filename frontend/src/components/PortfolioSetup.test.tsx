import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PortfolioSetup from './PortfolioSetup'
import { api } from '../config/api'
import {
  PORTFOLIO_SETUP_DRAFT_KEY,
  type PortfolioSetupDraft,
} from '../hooks/usePortfolio'
import { clearPortfolioCloneDraft, savePortfolioCloneDraft } from '../utils/portfolioCloneDraft'


// Strip framer-motion animation props so they don't hit the real DOM
const stripMotionProps = ({
  initial,
  animate,
  exit,
  transition,
  variants,
  layout,
  layoutId,
  ...rest
}: any) => rest

vi.mock('framer-motion', () => ({
  motion: {
    div: (props: any) =>
      React.createElement('div', stripMotionProps(props), props.children),
    p: (props: any) =>
      React.createElement('p', stripMotionProps(props), props.children),
  },
  AnimatePresence: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
}))

vi.mock('./ThemeToggle', () => ({ default: () => null }))
vi.mock('./AssetSelector', () => ({
    default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
        React.createElement('select', {
            value,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value),
        }),
}))

const mockMutateAsync = vi.fn()
const mockImportMutateAsync = vi.fn()
vi.mock("../hooks/mutations/usePortfolioMutations", () => ({
  buildRollbackMessage: (error: unknown, action = "portfolio update") => {
    const detail =
      error instanceof Error ? error.message : "server rejected the update";
    return `Your optimistic ${action} was rolled back because the server rejected it. ${detail} Please try again.`;
  },
  useCreatePortfolioMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  useImportPortfolioMutation: () => ({
    mutateAsync: mockImportMutateAsync,
    isPending: false,
  }),
}));

const mockAssets = [
    { symbol: 'XLM', displayName: 'XLM', searchText: 'xlm' },
    { symbol: 'USDC', displayName: 'USDC', searchText: 'usdc' },
    { symbol: 'BTC', displayName: 'BTC', searchText: 'btc' },
    { symbol: 'ETH', displayName: 'ETH', searchText: 'eth' },
]

vi.mock('../hooks/queries/useAssetsQuery', () => ({
    useAssets: () => ({
        data: mockAssets,
        isLoading: false,
    }),
}))

function renderSetup(publicKey: string | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onNavigate = vi.fn()
  const utils = render(
    <QueryClientProvider client={client}>
      <PortfolioSetup onNavigate={onNavigate} publicKey={publicKey} />
    </QueryClientProvider>,
  )
  return { ...utils, onNavigate }
}

/**
 * The balanced template (default) allocates:
 *   USDC 40%  XLM 30%  BTC 20%  ETH 10%  → total 100%
 *
 * getAllByRole('spinbutton') order for the balanced template:
 *   [0] USDC %   [1] XLM %   [2] BTC %   [3] ETH %
 *   [4] threshold (min 1, max 50, default 5)
 *   [5] slippage  (min 0.1, max 5, default 1)
 */

describe('PortfolioSetup allocation validation', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.localStorage.clear()
    mockMutateAsync.mockResolvedValue({})
    mockImportMutateAsync.mockResolvedValue({ portfolioId: 'imported-portfolio' })
    // Return empty assets so the component falls back to DEFAULT_ASSET_OPTIONS
    vi.spyOn(api, 'get').mockResolvedValue({ assets: [] } as any)
  })

  describe('import/export controls', () => {
    it('renders import and export buttons in portfolio settings', () => {
      renderSetup()

      expect(screen.getByRole('button', { name: /export json/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /import json/i })).toBeTruthy()
      expect(screen.getByLabelText(/import portfolio json/i)).toBeTruthy()
    })

    it('opens the import file picker when import is clicked', () => {
      renderSetup()

      const input = screen.getByLabelText(/import portfolio json/i) as HTMLInputElement
      const clickSpy = vi.spyOn(input, 'click')

      fireEvent.click(screen.getByRole('button', { name: /import json/i }))

      expect(clickSpy).toHaveBeenCalledTimes(1)
    })

    it('uploads a JSON file and sends it to the import mutation', async () => {
      renderSetup('GIMPORTTEST')

      const payload = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        userAddress: 'GIMPORTTEST',
        allocations: { XLM: 60, USDC: 40 },
        threshold: 5,
        slippageTolerance: 1.5,
        strategy: 'periodic',
        strategyConfig: { intervalDays: 14 },
      }

      const input = screen.getByLabelText(/import portfolio json/i) as HTMLInputElement
      const file = new File([JSON.stringify(payload)], 'portfolio.json', {
        type: 'application/json',
      })

      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockImportMutateAsync).toHaveBeenCalledWith(payload)
      })
    })
  })

  // ── Sum-to-100 boundary tests ─────────────────────────────────────────────

  describe('sum-to-100 boundary validation', () => {
    it('enables submit when allocations sum to exactly 100%', () => {
      renderSetup()
      const submit = screen.getByRole('button', {
        name: /create portfolio/i,
      }) as HTMLButtonElement
      expect(submit.disabled).toBe(false)
    })

    it('shows success status message when total equals 100%', () => {
      renderSetup()
      expect(screen.getByText(/allocations sum to 100%/i)).toBeTruthy()
    })

    it('disables submit and shows under-allocation message when total is 99%', () => {
      renderSetup()
      const inputs = screen.getAllByRole('spinbutton')
      // ETH: 10 → 9, total becomes 99%
      fireEvent.change(inputs[3], { target: { value: '9' } })

      const submit = screen.getByRole('button', {
        name: /create portfolio/i,
      }) as HTMLButtonElement
      expect(submit.disabled).toBe(true)
      expect(screen.getByText(/1% under/i)).toBeTruthy()
    })

    it('disables submit and shows over-allocation message when total is 101%', () => {
      renderSetup()
      const inputs = screen.getAllByRole('spinbutton')
      // ETH: 10 → 11, total becomes 101%
      fireEvent.change(inputs[3], { target: { value: '11' } })

      const submit = screen.getByRole('button', {
        name: /create portfolio/i,
      }) as HTMLButtonElement
      expect(submit.disabled).toBe(true)
      expect(screen.getByText(/1% over/i)).toBeTruthy()
    })

    it('re-enables submit when total is corrected back to 100%', () => {
      renderSetup()
      const inputs = screen.getAllByRole('spinbutton')

      fireEvent.change(inputs[3], { target: { value: '9' } })
      expect(
        (
          screen.getByRole('button', {
            name: /create portfolio/i,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true)

      fireEvent.change(inputs[3], { target: { value: '10' } })
      expect(
        (
          screen.getByRole('button', {
            name: /create portfolio/i,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false)
    })

    it('shows hint text beneath submit button when total is not 100%', () => {
      renderSetup()
      const inputs = screen.getAllByRole('spinbutton')
      fireEvent.change(inputs[3], { target: { value: '5' } })

      expect(
        screen.getByText(/fix validation errors above to continue/i),
      ).toBeTruthy()
    })
  })

  // ── Field-level error messages ────────────────────────────────────────────

  describe('field-level validation errors', () => {
    it('shows "Cannot be negative" and disables submit for a negative percentage', () => {
      renderSetup()
      const inputs = screen.getAllByRole('spinbutton')
      fireEvent.change(inputs[0], { target: { value: '-1' } })

      expect(screen.getByText(/cannot be negative/i)).toBeTruthy()
      expect(
        (
          screen.getByRole('button', {
            name: /create portfolio/i,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true)
    })

    it('shows "Cannot exceed 100%" and disables submit when percentage is over 100', () => {
      renderSetup()
      const inputs = screen.getAllByRole('spinbutton')
      fireEvent.change(inputs[0], { target: { value: '150' } })

      expect(screen.getByText(/cannot exceed 100%/i)).toBeTruthy()
      expect(
        (
          screen.getByRole('button', {
            name: /create portfolio/i,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true)
    })

    it('clears field error when value is corrected to a valid range', () => {
      renderSetup()
      const inputs = screen.getAllByRole('spinbutton')

      fireEvent.change(inputs[0], { target: { value: '-5' } })
      expect(screen.getByText(/cannot be negative/i)).toBeTruthy()

      fireEvent.change(inputs[0], { target: { value: '40' } })
      expect(screen.queryByText(/cannot be negative/i)).toBeNull()
    })
  })

  // ── Adding and removing assets ────────────────────────────────────────────

  describe('adding and removing assets', () => {
    it('disables Add Asset when all supported asset slots are in use', () => {
      renderSetup()
      // Balanced template uses all 4 DEFAULT_ASSET_OPTIONS
      const addBtn = screen.getByRole('button', {
        name: /\badd asset\b/i,
      }) as HTMLButtonElement
      expect(addBtn.disabled).toBe(true)
    })

    it('adds a new allocation row when clicking Add Asset', () => {
      renderSetup()
      // Conservative (3 assets) frees one slot → Add Asset becomes enabled
      fireEvent.click(screen.getByRole('button', { name: /conservative/i }))

      const before = screen.getAllByRole('spinbutton').length
      const addBtn = screen.getByRole('button', {
        name: /\badd asset\b/i,
      }) as HTMLButtonElement
      expect(addBtn.disabled).toBe(false)

      fireEvent.click(addBtn)
      expect(screen.getAllByRole('spinbutton').length).toBe(before + 1)
    })

    it('removes an allocation row when clicking a delete button', () => {
      const { container } = renderSetup()
      const before = screen.getAllByRole('spinbutton').length

      // Delete buttons carry the text-red-500 class; savedTemplates is empty so
      // these are exclusively the per-row allocation delete buttons
      const deleteButtons = container.querySelectorAll('button.text-red-500')
      expect(deleteButtons.length).toBeGreaterThan(0)

      fireEvent.click(deleteButtons[0])
      expect(screen.getAllByRole('spinbutton').length).toBe(before - 1)
    })

    it('hides delete button when only one allocation row remains', () => {
      const { container } = renderSetup()
      // Custom template starts with a single asset (XLM 100%)
      fireEvent.click(screen.getByRole('button', { name: /custom/i }))

      const deleteButtons = container.querySelectorAll('button.text-red-500')
      expect(deleteButtons.length).toBe(0)
    })
  })

  // ── Slippage and threshold fields ─────────────────────────────────────────

  describe('slippage and threshold field validation ranges', () => {
    it('threshold input enforces min=1 and max=50', () => {
      renderSetup()
      const threshold = screen.getAllByRole('spinbutton')[4] as HTMLInputElement
      expect(threshold.min).toBe('1')
      expect(threshold.max).toBe('50')
    })

    it('slippage input enforces min=0.1 and max=5', () => {
      renderSetup()
      const slippage = screen.getAllByRole('spinbutton')[5] as HTMLInputElement
      expect(slippage.min).toBe('0.1')
      expect(slippage.max).toBe('5')
    })

    it('updates the threshold value when changed', () => {
      renderSetup()
      const threshold = screen.getAllByRole('spinbutton')[4] as HTMLInputElement
      fireEvent.change(threshold, { target: { value: '10' } })
      expect(threshold.value).toBe('10')
    })

    it('updates the slippage value when changed', () => {
      renderSetup()
      const slippage = screen.getAllByRole('spinbutton')[5] as HTMLInputElement
      fireEvent.change(slippage, { target: { value: '2.5' } })
      expect(slippage.value).toBe('2.5')
    })
  })

  // ── Local draft persistence ────────────────────────────────────────────────

  describe('local draft persistence', () => {
    const draftKey = PORTFOLIO_SETUP_DRAFT_KEY(null)

    const savedDraft: PortfolioSetupDraft = {
      allocations: [
        { asset: 'USDC', percentage: 70 },
        { asset: 'XLM', percentage: 30 },
      ],
      threshold: 12,
      slippageTolerance: 2.5,
      strategy: 'periodic',
      strategyConfig: { intervalDays: 14 },
      autoRebalance: false,
      selectedTemplateId: 'conservative',
      savedAt: '2026-05-31T18:30:00.000Z',
    }

    it('saves edited setup inputs to local storage without blocking the form', async () => {
      renderSetup()
      const threshold = screen.getAllByRole('spinbutton')[4] as HTMLInputElement

      fireEvent.change(threshold, { target: { value: '10' } })

      await waitFor(() => {
        const rawDraft = window.localStorage.getItem(draftKey)
        expect(rawDraft).toBeTruthy()
        const parsed = JSON.parse(rawDraft as string)
        expect(parsed.threshold).toBe(10)
        expect(parsed.allocations).toHaveLength(4)
      })
    })

    it('offers a saved draft without restoring it until the user chooses restore', () => {
      window.localStorage.setItem(draftKey, JSON.stringify(savedDraft))

      renderSetup()

      expect(
        screen.getByRole('region', { name: /resume saved portfolio draft/i }),
      ).toBeTruthy()
      expect(
        (screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value,
      ).toBe('40')

      fireEvent.click(screen.getByRole('button', { name: /restore draft/i }))

      expect(
        (screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value,
      ).toBe('70')
      expect(
        (screen.getAllByRole('spinbutton')[2] as HTMLInputElement).value,
      ).toBe('14')
      expect(screen.getByText(/draft restored/i)).toBeTruthy()
    })

    it('lets users start fresh and clears the saved draft', () => {
      window.localStorage.setItem(draftKey, JSON.stringify(savedDraft))

      renderSetup()
      fireEvent.click(screen.getByRole('button', { name: /start fresh/i }))

      expect(
        screen.queryByRole('region', { name: /resume saved portfolio draft/i }),
      ).toBeNull()
      expect(window.localStorage.getItem(draftKey)).toBeNull()
    })

    it('surfaces an intentional failure state when a saved draft is unreadable', () => {
      window.localStorage.setItem(draftKey, JSON.stringify({ allocations: [] }))

      renderSetup()

      expect(screen.getByRole('alert').textContent).toContain(
        'Saved portfolio draft is no longer readable',
      )
      expect(
        screen.queryByRole('region', { name: /resume saved portfolio draft/i }),
      ).toBeNull()
    })

    it('clears the local draft after a portfolio is created successfully', async () => {
      window.localStorage.setItem(draftKey, JSON.stringify(savedDraft))

      renderSetup()
      fireEvent.click(screen.getByRole('button', { name: /restore draft/i }))
      fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }))

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1))
      expect(window.localStorage.getItem(draftKey)).toBeNull()
    })
  })

  describe('saved templates reload', () => {
    const anonymousKey = 'portfolio-templates-anonymous'

    it('refreshes saved templates when the connected wallet changes', () => {
      window.localStorage.setItem(
        anonymousKey,
        JSON.stringify([
          {
            id: 'saved-a',
            name: 'Anonymous Template',
            description: 'Stored for anonymous use',
            riskLevel: 'medium',
            allocations: [{ asset: 'XLM', percentage: 100 }],
          },
        ]),
      )

      const { rerender } = render(
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
            })
          }
        >
          <PortfolioSetup onNavigate={vi.fn()} publicKey={null} />
        </QueryClientProvider>,
      )

      expect(screen.getByText(/anonymous template/i)).toBeTruthy()

      window.localStorage.setItem(
        'portfolio-templates-GTESTUSER',
        JSON.stringify([
          {
            id: 'saved-b',
            name: 'Wallet Template',
            description: 'Stored for a connected wallet',
            riskLevel: 'low',
            allocations: [{ asset: 'USDC', percentage: 100 }],
          },
        ]),
      )

      rerender(
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
            })
          }
        >
          <PortfolioSetup onNavigate={vi.fn()} publicKey={'GTESTUSER'} />
        </QueryClientProvider>,
      )

      expect(screen.queryByText(/anonymous template/i)).toBeNull()
      expect(screen.getByText(/wallet template/i)).toBeTruthy()
    })
  })

  // ── Submit button state ───────────────────────────────────────────────────

  describe('submit button state', () => {
    it('calls mutateAsync when form is valid and submit is clicked', async () => {
      renderSetup()
      fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }))
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    it('does not call mutateAsync when total is not 100%', () => {
      renderSetup()
      const inputs = screen.getAllByRole('spinbutton')
      fireEvent.change(inputs[3], { target: { value: '5' } })

      fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }))
      expect(mockMutateAsync).not.toHaveBeenCalled()
        it('updates the threshold value when changed', () => {
            renderSetup()
            const threshold = screen.getAllByRole('spinbutton')[4] as HTMLInputElement
            fireEvent.change(threshold, { target: { value: '10' } })
            expect(threshold.value).toBe('10')
        })

        it('updates the slippage value when changed', () => {
            renderSetup()
            const slippage = screen.getAllByRole('spinbutton')[5] as HTMLInputElement
            fireEvent.change(slippage, { target: { value: '2.5' } })
            expect(slippage.value).toBe('2.5')
        })
    })

    // ── Submit button state ───────────────────────────────────────────────────

    describe('portfolio clone draft', () => {
        it('prefills setup from a saved clone draft and saves as a new portfolio', async () => {
            savePortfolioCloneDraft({
                sourcePortfolioId: 'p-source',
                sourceLabel: 'Source',
                allocations: [
                    { asset: 'BTC', percentage: 70 },
                    { asset: 'ETH', percentage: 30 },
                ],
                threshold: 8,
                slippageTolerance: 2,
                strategy: 'volatility',
                strategyConfig: { volatilityThresholdPct: 12 },
                createdAt: new Date().toISOString(),
            })

            renderSetup('GTESTCLONE')
            expect(screen.getByText(/cloning portfolio source/i)).toBeTruthy()
            expect(screen.getByRole('button', { name: /save as new portfolio/i })).toBeTruthy()

            fireEvent.click(screen.getByRole('button', { name: /save as new portfolio/i }))
            expect(mockMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    threshold: 8,
                    slippageTolerance: 2,
                    strategy: 'volatility',
                    allocations: { BTC: 70, ETH: 30 },
                }),
            )
        })
    })

    describe('submit button state', () => {
        it('calls mutateAsync when form is valid and submit is clicked', async () => {
            renderSetup()
            fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }))
            expect(mockMutateAsync).toHaveBeenCalledTimes(1)
        })
        it("shows a clear rollback message when portfolio creation is rejected", async () => {
          mockMutateAsync.mockRejectedValueOnce(
            new Error("server rejected allocation update"),
          );

          renderSetup();

          fireEvent.click(
            screen.getByRole("button", { name: /create portfolio/i }),
          );

          const alert = await screen.findByRole("alert");

          expect(alert).toHaveTextContent(/rolled back/i);
          expect(alert).toHaveTextContent(/server rejected/i);
          expect(alert).toHaveTextContent(/try again/i);
        });

        it('does not call mutateAsync when total is not 100%', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            fireEvent.change(inputs[3], { target: { value: '5' } })

            fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }))
            expect(mockMutateAsync).not.toHaveBeenCalled()
        })
    })
  })

    // ── Remaining-allocation progress bar ─────────────────────────────────────

    describe('remaining-allocation progress bar', () => {
        it('renders a progressbar element', () => {
            renderSetup()
            expect(screen.getByRole('progressbar')).toBeTruthy()
        })

        it('sets aria-valuenow to the current total percentage', () => {
            renderSetup()
            // Balanced template starts at 100%
            const bar = screen.getByRole('progressbar')
            expect(bar.getAttribute('aria-valuenow')).toBe('100')
        })

        it('updates aria-valuenow when allocations change', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            // ETH: 10 → 5, total becomes 95%
            fireEvent.change(inputs[3], { target: { value: '5' } })
            const bar = screen.getByRole('progressbar')
            expect(bar.getAttribute('aria-valuenow')).toBe('95')
        })

        it('shows remaining label when total is under 100%', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            fireEvent.change(inputs[3], { target: { value: '5' } })
            expect(screen.getByText(/remaining:/i)).toBeTruthy()
        })

        it('hides remaining label when total equals 100%', () => {
            renderSetup()
            expect(screen.queryByText(/remaining:/i)).toBeNull()
        })
    })
})

// ── remainingAllocation unit tests ───────────────────────────────────────────

import { remainingAllocation } from '../utils/calculations'

describe('remainingAllocation', () => {
    it('returns 0 when allocations sum to exactly 100', () => {
        expect(remainingAllocation([{ percentage: 40 }, { percentage: 30 }, { percentage: 30 }])).toBe(0)
    })

    it('returns positive value when under-allocated', () => {
        expect(remainingAllocation([{ percentage: 40 }, { percentage: 30 }])).toBe(30)
    })

    it('returns negative value when over-allocated', () => {
        expect(remainingAllocation([{ percentage: 60 }, { percentage: 50 }])).toBe(-10)
    })

    it('returns 100 for an empty array', () => {
        expect(remainingAllocation([])).toBe(100)
    })

    it('handles floating-point allocations without precision errors', () => {
        // 33.3 + 33.3 + 33.4 = 100.0 exactly after rounding
        const result = remainingAllocation([
            { percentage: 33.3 },
            { percentage: 33.3 },
            { percentage: 33.4 },
        ])
        expect(Math.abs(result)).toBeLessThan(0.01)
    })
})
