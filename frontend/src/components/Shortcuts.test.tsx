import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Shortcuts from './Shortcuts'
import { DEFAULT_KEYBINDINGS, STORAGE_KEY } from '../hooks/useKeybindings'

describe('Shortcuts – customizable keybindings', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  // -----------------------------------------------------------------------
  // 1. Default shortcut fires the correct action
  // -----------------------------------------------------------------------
  it('fires onNewPortfolio when the default "n" key is pressed', () => {
    const onNewPortfolio = vi.fn()
    render(<Shortcuts onNewPortfolio={onNewPortfolio} />)

    fireEvent.keyDown(window, { key: 'n' })
    expect(onNewPortfolio).toHaveBeenCalledTimes(1)
  })

  it('fires onExecuteRebalance when the default "r" key is pressed', () => {
    const onExecuteRebalance = vi.fn()
    render(<Shortcuts onExecuteRebalance={onExecuteRebalance} />)

    fireEvent.keyDown(window, { key: 'r' })
    expect(onExecuteRebalance).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // 2. Remapped shortcut fires the correct action
  // -----------------------------------------------------------------------
  it('fires onNewPortfolio when the remapped key is pressed', () => {
    // Remap newPortfolio from 'n' to 'x'
    const custom = { ...DEFAULT_KEYBINDINGS, newPortfolio: 'x' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))

    const onNewPortfolio = vi.fn()
    render(<Shortcuts onNewPortfolio={onNewPortfolio} />)

    fireEvent.keyDown(window, { key: 'x' })
    expect(onNewPortfolio).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // 3. Old default key no longer fires after remap
  // -----------------------------------------------------------------------
  it('does NOT fire onNewPortfolio when the old default key "n" is pressed after remap', () => {
    const custom = { ...DEFAULT_KEYBINDINGS, newPortfolio: 'x' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))

    const onNewPortfolio = vi.fn()
    render(<Shortcuts onNewPortfolio={onNewPortfolio} />)

    fireEvent.keyDown(window, { key: 'n' })
    expect(onNewPortfolio).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // 4. Conflict detection shows a warning in the settings modal
  // -----------------------------------------------------------------------
  it('shows a conflict warning when assigning a key already used by another action', async () => {
    render(<Shortcuts />)

    // Open shortcuts panel
    fireEvent.keyDown(window, { key: '?' })

    // Click "Customize" to open the settings modal
    const customizeButton = screen.getByText('Customize')
    fireEvent.click(customizeButton)

    // The settings modal should be open with "Customize Shortcuts" title
    expect(screen.getByText('Customize Shortcuts')).toBeTruthy()

    // Click the key button for "Create new portfolio" to start listening
    const newPortfolioBtn = screen.getByLabelText('Change key for Create new portfolio')
    fireEvent.click(newPortfolioBtn)

    // Press 'r' which is already assigned to "Execute rebalance"
    fireEvent.keyDown(window, { key: 'r' })

    // A conflict alert should appear
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Already assigned to')
    expect(alert.textContent).toContain('Execute rebalance')
  })

  // -----------------------------------------------------------------------
  // 5. The shortcuts panel displays updated keys after remapping
  // -----------------------------------------------------------------------
  it('displays custom keys in the shortcuts panel', () => {
    const custom = { ...DEFAULT_KEYBINDINGS, newPortfolio: 'p' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))

    render(<Shortcuts />)

    // Open shortcuts panel
    fireEvent.keyDown(window, { key: '?' })

    // The panel should show 'p' as the key for "Create new portfolio"
    const kbdElements = screen.getAllByText('p')
    expect(kbdElements.length).toBeGreaterThanOrEqual(1)
  })

  // -----------------------------------------------------------------------
  // 6. Shortcuts are suppressed when the settings modal is open
  // -----------------------------------------------------------------------
  it('does not fire shortcuts while the settings modal is open', () => {
    const onNewPortfolio = vi.fn()
    render(<Shortcuts onNewPortfolio={onNewPortfolio} />)

    // Open shortcuts panel, then settings
    fireEvent.keyDown(window, { key: '?' })
    const customizeButton = screen.getByText('Customize')
    fireEvent.click(customizeButton)

    // Now press 'n' — should NOT fire because settings is open
    fireEvent.keyDown(window, { key: 'n' })
    expect(onNewPortfolio).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // 7. End-to-end: remap via UI on a live instance, then use new key
  // -----------------------------------------------------------------------
  it('remaps a shortcut through the Customize UI and fires it on the same mounted instance', () => {
    const onNewPortfolio = vi.fn()
    render(<Shortcuts onNewPortfolio={onNewPortfolio} />)

    // Verify default 'n' works before remapping
    fireEvent.keyDown(window, { key: 'n' })
    expect(onNewPortfolio).toHaveBeenCalledTimes(1)
    onNewPortfolio.mockClear()

    // Open shortcuts panel → open Customize modal
    fireEvent.keyDown(window, { key: '?' })
    fireEvent.click(screen.getByText('Customize'))

    // Click the key button for "Create new portfolio" to start listening
    fireEvent.click(screen.getByLabelText('Change key for Create new portfolio'))

    // Press 'x' to remap
    fireEvent.keyDown(window, { key: 'x' })

    // Close the settings modal
    fireEvent.click(screen.getByText('Done'))

    // Close the shortcuts panel by pressing the (unchanged) '?' key
    fireEvent.keyDown(window, { key: '?' })

    // Now press the NEW key 'x' — should fire
    fireEvent.keyDown(window, { key: 'x' })
    expect(onNewPortfolio).toHaveBeenCalledTimes(1)

    // And the OLD key 'n' should no longer fire
    onNewPortfolio.mockClear()
    fireEvent.keyDown(window, { key: 'n' })
    expect(onNewPortfolio).not.toHaveBeenCalled()
  })
})
