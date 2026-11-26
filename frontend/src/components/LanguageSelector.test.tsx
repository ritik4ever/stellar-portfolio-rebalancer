import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import LanguageSelector from './LanguageSelector'
import i18n, { SUPPORTED_LOCALES } from '../i18n'

function renderSelector() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LanguageSelector />
    </I18nextProvider>,
  )
}

describe('LanguageSelector', () => {
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en')
  })

  it('lists every supported locale including French and German', () => {
    renderSelector()
    fireEvent.click(screen.getByLabelText('Change language'))

    for (const locale of SUPPORTED_LOCALES) {
      expect(screen.getByRole('menuitem', { name: locale.label })).toBeInTheDocument()
    }
  })

  it('switches the active locale when a language is selected', async () => {
    renderSelector()
    fireEvent.click(screen.getByLabelText('Change language'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Français' }))

    expect(i18n.language).toBe('fr')
  })

  describe('keyboard and screen-reader behaviour', () => {
    const trigger = () => screen.getByRole('button', { name: 'Change language' })
    const items = () => screen.getAllByRole('menuitem')

    it('ties the trigger to a named menu and marks the active language', () => {
      renderSelector()
      const menu = screen.getByRole('menu', { name: 'Language', hidden: true })
      expect(trigger()).toHaveAttribute('aria-controls', menu.id)
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')

      const current = items().filter(item => item.getAttribute('aria-current') === 'true')
      expect(current).toHaveLength(1)
      expect(current[0]).toHaveTextContent('English')
    })

    it('moves focus onto the active language when opened with the keyboard', async () => {
      const user = userEvent.setup()
      renderSelector()
      trigger().focus()
      await user.keyboard('{Enter}')

      expect(trigger()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('menuitem', { name: 'English' })).toHaveFocus()
    })

    it('opens from the trigger with ArrowDown', async () => {
      const user = userEvent.setup()
      renderSelector()
      trigger().focus()
      await user.keyboard('{ArrowDown}')
      expect(trigger()).toHaveAttribute('aria-expanded', 'true')
      expect(items().some(item => item === document.activeElement)).toBe(true)
    })

    it('moves between languages with the arrow keys, Home and End, wrapping at the ends', async () => {
      const user = userEvent.setup()
      renderSelector()
      await user.click(trigger())

      const list = items()
      list[0].focus()
      await user.keyboard('{ArrowUp}')
      expect(list[list.length - 1]).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      expect(list[0]).toHaveFocus()
      await user.keyboard('{End}')
      expect(list[list.length - 1]).toHaveFocus()
      await user.keyboard('{Home}')
      expect(list[0]).toHaveFocus()
    })

    it('closes on Escape and returns focus to the trigger', async () => {
      const user = userEvent.setup()
      renderSelector()
      await user.click(trigger())
      await user.keyboard('{Escape}')

      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
      expect(trigger()).toHaveFocus()
    })

    it('closes when Tab moves focus out of the menu', async () => {
      const user = userEvent.setup()
      renderSelector()
      await user.click(trigger())
      await user.keyboard('{Tab}')
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes on a press outside and leaves focus where the user put it', async () => {
      const user = userEvent.setup()
      render(
        <I18nextProvider i18n={i18n}>
          <LanguageSelector />
          <button type="button">elsewhere</button>
        </I18nextProvider>,
      )
      await user.click(trigger())
      expect(trigger()).toHaveAttribute('aria-expanded', 'true')

      await user.click(screen.getByRole('button', { name: 'elsewhere' }))
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: 'elsewhere' })).toHaveFocus()
    })

    it('keeps focus on the trigger after choosing a language', async () => {
      const user = userEvent.setup()
      renderSelector()
      await user.click(trigger())
      await user.click(screen.getByRole('menuitem', { name: 'Français' }))
      expect(trigger()).toHaveFocus()
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    })
  })
})
