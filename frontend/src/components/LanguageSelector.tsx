import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { SUPPORTED_LOCALES } from '../i18n'

const LanguageSelector = () => {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const activeLanguage = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0]

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  // Move focus into the menu when it opens (on the active language), so a
  // keyboard or screen-reader user lands inside the popup they just opened.
  useEffect(() => {
    if (!isOpen) return
    const items = menuItems()
    const active = items.find((item) => item.getAttribute('aria-current') === 'true')
    ;(active ?? items[0])?.focus()
  }, [isOpen])

  // Dismiss on a pointer press outside; the menu would otherwise stay open
  // over page content (for example while the wallet state changes behind it).
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [isOpen])

  const closeMenu = () => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
    closeMenu()
  }

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setIsOpen(!isOpen)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
    } else if (e.key === 'Escape') {
      closeMenu()
    }
  }

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = menuItems()
    const index = items.indexOf(document.activeElement as HTMLElement)
    switch (e.key) {
      case 'Escape':
        closeMenu()
        break
      case 'ArrowDown':
        e.preventDefault()
        items[(index + 1) % items.length]?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        items[(index - 1 + items.length) % items.length]?.focus()
        break
      case 'Home':
        e.preventDefault()
        items[0]?.focus()
        break
      case 'End':
        e.preventDefault()
        items[items.length - 1]?.focus()
        break
      case 'Tab':
        // Let focus move on naturally, but do not leave the menu open behind it.
        setIsOpen(false)
        break
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Change language"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls={menuId}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
      >
        <Globe className="w-4 h-4" aria-hidden />
        <span className="text-sm font-medium">{activeLanguage.toUpperCase()}</span>
      </button>
      <div
        id={menuId}
        ref={menuRef}
        className={`absolute right-0 mt-2 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 transition-all z-50 ${
          isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        role="menu"
        aria-label="Language"
        onKeyDown={handleMenuKeyDown}
      >
        <div className="py-1">
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale.code}
              type="button"
              onClick={() => changeLanguage(locale.code)}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                activeLanguage === locale.code ? 'font-semibold bg-gray-50 dark:bg-gray-700' : ''
              }`}
              role="menuitem"
              tabIndex={-1}
              aria-current={activeLanguage === locale.code ? 'true' : undefined}
            >
              {locale.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default LanguageSelector
