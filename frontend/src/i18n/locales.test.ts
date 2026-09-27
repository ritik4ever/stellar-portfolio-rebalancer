import { describe, it, expect } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'
import pt from './locales/pt.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import i18n, { SUPPORTED_LOCALES } from './index'

function collectKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    collectKeys(nested, prefix ? `${prefix}.${key}` : key),
  )
}

describe('i18n locales', () => {
  const englishKeys = collectKeys(en).sort()

  it.each([
    ['es', es],
    ['pt', pt],
    ['fr', fr],
    ['de', de],
  ] as const)('%s contains every English translation key', (_code, locale) => {
    const localeKeys = new Set(collectKeys(locale))
    const missing = englishKeys.filter((key) => !localeKeys.has(key))
    expect(missing).toEqual([])
  })

  it('registers every supported locale in i18n without errors', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(i18n.hasResourceBundle(locale.code, 'translation')).toBe(true)
    }
  })

  it('loads French and German resource bundles', () => {
    expect(i18n.getResourceBundle('fr', 'translation').dashboard.title).toBe(
      'Tableau de bord du portefeuille',
    )
    expect(i18n.getResourceBundle('de', 'translation').dashboard.title).toBe('Portfolio-Dashboard')
  })
})
