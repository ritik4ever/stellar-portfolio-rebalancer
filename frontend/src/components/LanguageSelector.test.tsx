import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
})
