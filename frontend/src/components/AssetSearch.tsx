import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Search, X, AlertTriangle, Check } from 'lucide-react'
import { useAssets } from '../hooks/queries/useAssetsQuery'
import { api, ENDPOINTS } from '../config/api'

interface AssetSearchAsset {
  symbol: string
  name?: string
  issuer?: string
  domain?: string
  contract?: string
  type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12'
}

interface AssetSearchResult extends AssetSearchAsset {
  displayName: string
  searchText: string
  isSupported: boolean
}

interface AssetSearchProps {
  value: string
  onChange: (asset: string) => void
  supportedContracts?: string[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])
  return debouncedValue
}

function formatContractAddress(address?: string): string {
  if (!address) return ''
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

const AssetSearch: React.FC<AssetSearchProps> = ({
  value,
  onChange,
  supportedContracts = [],
  placeholder = 'Search assets...',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [isSearching, setIsSearching] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debouncedSearch = useDebounce(searchQuery, 250)

  const { data: staticAssets = [] } = useAssets()

  const [dynamicResults, setDynamicResults] = useState<AssetSearchAsset[]>([])
  const [dynamicError, setDynamicError] = useState<string | null>(null)

  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 1) {
      setDynamicResults([])
      setDynamicError(null)
      setIsSearching(false)
      return
    }

    let cancelled = false
    setIsSearching(true)
    setDynamicError(null)

    api.get<{ assets: AssetSearchAsset[] }>(`${ENDPOINTS.ASSETS}?search=${encodeURIComponent(debouncedSearch)}`)
      .then((res) => {
        if (!cancelled) {
          setDynamicResults(res?.assets ?? [])
          setIsSearching(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDynamicError('Search failed')
          setDynamicResults([])
          setIsSearching(false)
        }
      })

    return () => { cancelled = true }
  }, [debouncedSearch])

  const allResults = useMemo<AssetSearchResult[]>(() => {
    const combined = new Map<string, AssetSearchResult>()

    for (const asset of staticAssets as AssetSearchAsset[]) {
      const searchText = [asset.symbol, asset.name, asset.issuer, asset.domain].filter(Boolean).join(' ').toLowerCase()
      if (!debouncedSearch || searchText.includes(debouncedSearch.toLowerCase())) {
        combined.set(asset.symbol, {
          ...asset,
          displayName: asset.name ? `${asset.symbol} (${asset.name})` : asset.symbol,
          searchText,
          isSupported: supportedContracts.length === 0 || (asset.contract ? supportedContracts.includes(asset.contract) : false),
        })
      }
    }

    for (const asset of dynamicResults) {
      if (!combined.has(asset.symbol)) {
        const searchText = [asset.symbol, asset.name, asset.issuer, asset.domain].filter(Boolean).join(' ').toLowerCase()
        combined.set(asset.symbol, {
          ...asset,
          displayName: asset.name ? `${asset.symbol} (${asset.name})` : asset.symbol,
          searchText,
          isSupported: supportedContracts.length === 0 || (asset.contract ? supportedContracts.includes(asset.contract) : false),
        })
      }
    }

    return Array.from(combined.values())
  }, [staticAssets, dynamicResults, debouncedSearch, supportedContracts])

  const selectedAsset = useMemo(
    () => allResults.find(a => a.symbol === value),
    [allResults, value]
  )

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
        setHighlightedIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        setIsOpen(false)
        setSearchQuery('')
        setHighlightedIndex(-1)
        break
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => prev < allResults.length - 1 ? prev + 1 : 0)
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : allResults.length - 1)
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && allResults[highlightedIndex]) {
          handleSelect(allResults[highlightedIndex])
        }
        break
    }
  }, [isOpen, allResults, highlightedIndex])

  const handleSelect = useCallback((asset: AssetSearchResult) => {
    onChange(asset.symbol)
    setIsOpen(false)
    setSearchQuery('')
    setHighlightedIndex(-1)
  }, [onChange])

  const handleClear = useCallback(() => {
    onChange('')
    setSearchQuery('')
    setHighlightedIndex(-1)
  }, [onChange])

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="asset-search-listbox"
        aria-label="Search assets"
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            role="searchbox"
            aria-autocomplete="list"
            aria-controls="asset-search-listbox"
            aria-activedescendant={highlightedIndex >= 0 ? `asset-result-${highlightedIndex}` : undefined}
            value={isOpen ? searchQuery : value || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              if (!isOpen) setIsOpen(true)
              setSearchQuery(e.target.value)
              setHighlightedIndex(-1)
            }}
            onFocus={() => {
              if (!isOpen) {
                setIsOpen(true)
                setSearchQuery('')
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div
          id="asset-search-listbox"
          role="listbox"
          aria-label="Asset search results"
          className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-80 overflow-hidden"
        >
          <div className="max-h-72 overflow-y-auto">
            {isSearching ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                Searching...
              </div>
            ) : dynamicError ? (
              <div className="p-4 text-center text-sm text-red-500 dark:text-red-400">
                {dynamicError}
              </div>
            ) : allResults.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                {debouncedSearch ? `No assets matching "${debouncedSearch}"` : 'Start typing to search assets'}
              </div>
            ) : (
              allResults.map((asset, index) => (
                <button
                  key={`${asset.symbol}-${asset.issuer || 'native'}`}
                  id={`asset-result-${index}`}
                  role="option"
                  aria-selected={value === asset.symbol}
                  type="button"
                  onClick={() => handleSelect(asset)}
                  className={`w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 ${
                    highlightedIndex === index ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  } ${value === asset.symbol ? 'bg-blue-100 dark:bg-blue-900/40' : ''} transition-colors`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${
                    asset.type === 'native' ? 'bg-blue-500' : 'bg-purple-500'
                  }`}>
                    {asset.symbol.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {asset.symbol}
                      </span>
                      {value === asset.symbol && (
                        <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      )}
                      {!asset.isSupported && supportedContracts.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded">
                          <AlertTriangle className="w-3 h-3" />
                          Unsupported
                        </span>
                      )}
                      {asset.isSupported && supportedContracts.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 px-2 py-0.5 rounded">
                          <Check className="w-3 h-3" />
                          Supported
                        </span>
                      )}
                    </div>
                    {asset.name && (
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        {asset.name}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {asset.contract ? (
                        <span>Contract: {formatContractAddress(asset.contract)}</span>
                      ) : asset.issuer ? (
                        <span>Issuer: {formatContractAddress(asset.issuer)}</span>
                      ) : null}
                      {asset.domain && (
                        <span className="text-blue-600 dark:text-blue-400">{asset.domain}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default AssetSearch
