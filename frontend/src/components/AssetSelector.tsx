import React, { useState, useRef, useEffect } from 'react'
import { Search, ChevronDown, Check, ExternalLink } from 'lucide-react'
import { useAssets } from '../hooks/queries/useAssetsQuery'

interface AssetSelectorProps {
    value: string
    onChange: (asset: string) => void
    placeholder?: string
    disabled?: boolean
    className?: string
}

interface Asset {
    symbol: string
    name?: string
    issuer?: string
    domain?: string
    type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12'
    displayName: string
    searchText: string
}

const AssetSelector: React.FC<AssetSelectorProps> = ({
    value,
    onChange,
    placeholder = "Select asset...",
    disabled = false,
    className = ""
}) => {
    const [isOpen, setIsOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)

    const { data: assets = [], isLoading } = useAssets()

    // Filter assets based on search query
    const filteredAssets = assets.filter((asset: Asset) =>
        asset.searchText.includes(searchQuery.toLowerCase())
    )

    // Find selected asset
    const selectedAsset = assets.find((asset: Asset) => asset.symbol === value)

    // Close dropdown when clicking outside
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

    // Focus search input when dropdown opens
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            searchInputRef.current.focus()
        }
    }, [isOpen])

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
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
                setHighlightedIndex((prev: number) => 
                    prev < filteredAssets.length - 1 ? prev + 1 : 0
                )
                break
            case 'ArrowUp':
                e.preventDefault()
                setHighlightedIndex((prev: number) => 
                    prev > 0 ? prev - 1 : filteredAssets.length - 1
                )
                break
            case 'Enter':
                e.preventDefault()
                if (highlightedIndex >= 0 && filteredAssets[highlightedIndex]) {
                    handleSelect(filteredAssets[highlightedIndex])
                }
                break
        }
    }

    const handleSelect = (asset: Asset) => {
        onChange(asset.symbol)
        setIsOpen(false)
        setSearchQuery('')
        setHighlightedIndex(-1)
    }

    const formatIssuer = (issuer: string) => {
        return `${issuer.slice(0, 4)}...${issuer.slice(-4)}`
    }

    const getStellarExpertUrl = (asset: Asset) => {
        if (asset.type === 'native') {
            return 'https://stellar.expert/explorer/public/asset/XLM'
        }
        return `https://stellar.expert/explorer/public/asset/${asset.symbol}-${asset.issuer}`
    }

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            {/* Trigger Button */}
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                className={`
                    w-full flex items-center justify-between px-3 py-2 
                    border border-gray-300 dark:border-gray-600 
                    bg-white dark:bg-gray-700 
                    text-gray-900 dark:text-white 
                    rounded-lg text-sm
                    hover:border-gray-400 dark:hover:border-gray-500
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors
                `}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {selectedAsset ? (
                        <>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                                selectedAsset.type === 'native' 
                                    ? 'bg-blue-500' 
                                    : 'bg-purple-500'
                            }`}>
                                {selectedAsset.symbol.slice(0, 2)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="font-medium truncate">{selectedAsset.symbol}</div>
                                {selectedAsset.name && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                        {selectedAsset.name}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <span className="text-gray-500 dark:text-gray-400">{placeholder}</span>
                    )}
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${
                    isOpen ? 'rotate-180' : ''
                }`} />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-80 overflow-hidden">
                    {/* Search Input */}
                    <div className="p-3 border-b border-gray-200 dark:border-gray-600">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    setSearchQuery(e.target.value)
                                    setHighlightedIndex(-1)
                                }}
                                onKeyDown={handleKeyDown}
                                placeholder="Search assets, issuers, or domains..."
                                className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>

                    {/* Asset List */}
                    <div className="max-h-60 overflow-y-auto">
                        {isLoading ? (
                            <div className="p-3 text-center text-gray-500 dark:text-gray-400">
                                Loading assets...
                            </div>
                        ) : filteredAssets.length === 0 ? (
                            <div className="p-3 text-center text-gray-500 dark:text-gray-400">
                                No assets found matching "{searchQuery}"
                            </div>
                        ) : (
                            filteredAssets.map((asset, index) => (
                                <button
                                    key={`${asset.symbol}-${asset.issuer || 'native'}`}
                                    type="button"
                                    onClick={() => handleSelect(asset)}
                                    className={`
                                        w-full flex items-center gap-3 px-3 py-3 text-left
                                        hover:bg-gray-50 dark:hover:bg-gray-700
                                        ${highlightedIndex === index ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
                                        ${value === asset.symbol ? 'bg-blue-100 dark:bg-blue-900/40' : ''}
                                        transition-colors
                                    `}
                                >
                                    {/* Asset Icon */}
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${
                                        asset.type === 'native' 
                                            ? 'bg-blue-500' 
                                            : 'bg-purple-500'
                                    }`}>
                                        {asset.symbol.slice(0, 2)}
                                    </div>

                                    {/* Asset Info */}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-gray-900 dark:text-white">
                                                {asset.symbol}
                                            </span>
                                            {value === asset.symbol && (
                                                <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                            )}
                                        </div>
                                        {asset.name && (
                                            <div className="text-sm text-gray-600 dark:text-gray-300">
                                                {asset.name}
                                            </div>
                                        )}
                                        {asset.issuer && (
                                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                <span>Issuer: {formatIssuer(asset.issuer)}</span>
                                                {asset.domain && (
                                                    <span className="text-blue-600 dark:text-blue-400">
                                                        {asset.domain}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* External Link */}
                                    <a
                                        href={getStellarExpertUrl(asset)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                        className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                        title="View on Stellar Expert"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default AssetSelector