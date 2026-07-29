import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { useState, useRef } from 'react'

const LanguageSelector = () => {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

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
    }
    if (e.key === 'Escape') {
      closeMenu()
    }
  }

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeMenu()
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Change language"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
      >
        <Globe className="w-4 h-4" />
        <span className="text-sm font-medium">{i18n.language.toUpperCase()}</span>
      </button>
      <div
        className={`absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 transition-all z-50 ${
          isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        role="menu"
        onKeyDown={handleMenuKeyDown}
      >
        <div className="py-1">
          <button
            onClick={() => changeLanguage('en')}
            className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
              i18n.language === 'en' ? 'font-semibold bg-gray-50 dark:bg-gray-700' : ''
            }`}
            role="menuitem"
          >
            English
          </button>
          <button
            onClick={() => changeLanguage('es')}
            className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
              i18n.language === 'es' ? 'font-semibold bg-gray-50 dark:bg-gray-700' : ''
            }`}
            role="menuitem"
          >
            Español
          </button>
          <button
            onClick={() => changeLanguage('pt')}
            className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
              i18n.language === 'pt' ? 'font-semibold bg-gray-50 dark:bg-gray-700' : ''
            }`}
            role="menuitem"
          >
            Português
          </button>
        </div>
      </div>
    </div>
  )
}

export default LanguageSelector
