/**
 * AssetList — drag-to-reorder asset cards on the portfolio dashboard.
 *
 * Features
 * --------
 * • Mouse drag (HTML5 DnD API)
 * • Touch drag (pointer events fallback)
 * • Keyboard reorder: arrow keys move the focused item, Enter/Space confirm
 * • Order persisted in localStorage per portfolio via useAssetOrder
 * • Reorder only affects display — allocations are never mutated
 * • Respects prefers-reduced-motion: drag animation is skipped when set
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import AssetCard from './AssetCard'
import { loadAssetOrder, saveAssetOrder, applyAssetOrder } from '../hooks/useAssetOrder'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AssetItem {
  name: string
  value: number
  amount: number
  color: string
  issuer?: string
  domain?: string
  type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12'
}

export interface PriceItem {
  price: number | null
  change: number | null
  source?: string
  quoteAgeSeconds?: number
  servedFromCache?: boolean
  dataTier?: string
}

interface AssetListProps {
  /** Portfolio id used to scope the localStorage order key. */
  portfolioId: string
  assets: AssetItem[]
  prices: Record<string, PriceItem | undefined>
  isLoading?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list
  const result = [...list]
  const [moved] = result.splice(from, 1)
  result.splice(to, 0, moved)
  return result
}

// ─── Component ───────────────────────────────────────────────────────────────

const AssetList: React.FC<AssetListProps> = ({
  portfolioId,
  assets,
  prices,
  isLoading = false,
}) => {
  // Apply persisted order on first render and when assets change
  const [orderedAssets, setOrderedAssets] = useState<AssetItem[]>(() =>
    applyAssetOrder(assets, loadAssetOrder(portfolioId)),
  )

  // Sync when assets prop changes (e.g. new portfolio loaded)
  useEffect(() => {
    setOrderedAssets(applyAssetOrder(assets, loadAssetOrder(portfolioId)))
  }, [assets, portfolioId])

  // Persist order whenever it changes
  const persistOrder = useCallback(
    (next: AssetItem[]) => {
      saveAssetOrder(portfolioId, next.map((a) => a.name))
    },
    [portfolioId],
  )

  // ── Drag state ────────────────────────────────────────────────────────────

  const dragIndex = useRef<number | null>(null)
  const dragOverIndex = useRef<number | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)

  // ── HTML5 drag handlers ───────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      dragIndex.current = index
      setDraggingIndex(index)
      // Set drag image to the element itself for a clean UX
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
    },
    [],
  )

  const handleDragEnter = useCallback(
    (_e: React.DragEvent<HTMLDivElement>, index: number) => {
      if (dragIndex.current === null || dragIndex.current === index) return
      dragOverIndex.current = index
      setDropTargetIndex(index)
    },
    [],
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault()
      if (dragIndex.current === null || dragIndex.current === index) return
      const next = reorder(orderedAssets, dragIndex.current, index)
      setOrderedAssets(next)
      persistOrder(next)
    },
    [orderedAssets, persistOrder],
  )

  const handleDragEnd = useCallback(() => {
    dragIndex.current = null
    dragOverIndex.current = null
    setDraggingIndex(null)
    setDropTargetIndex(null)
  }, [])

  // ── Touch / pointer drag ──────────────────────────────────────────────────
  // We use pointer events so touch works without a library.

  const pointerOriginIndex = useRef<number | null>(null)
  const pointerOriginY = useRef<number>(0)
  const pointerCurrentY = useRef<number>(0)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const [touchDraggingIndex, setTouchDraggingIndex] = useState<number | null>(null)
  const [touchDropIndex, setTouchDropIndex] = useState<number | null>(null)

  const resolveDropIndexFromY = useCallback(
    (clientY: number): number | null => {
      for (let i = 0; i < itemRefs.current.length; i++) {
        const el = itemRefs.current[i]
        if (!el) continue
        const { top, bottom } = el.getBoundingClientRect()
        const mid = (top + bottom) / 2
        if (clientY < mid) return i
      }
      return itemRefs.current.length - 1
    },
    [],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, index: number) => {
      // Only act on touch/pen; mouse is handled by HTML5 DnD
      if (e.pointerType === 'mouse') return
      e.currentTarget.setPointerCapture(e.pointerId)
      pointerOriginIndex.current = index
      pointerOriginY.current = e.clientY
      pointerCurrentY.current = e.clientY
      setTouchDraggingIndex(index)
    },
    [],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerOriginIndex.current === null) return
      pointerCurrentY.current = e.clientY
      const overIndex = resolveDropIndexFromY(e.clientY)
      setTouchDropIndex(overIndex)
    },
    [resolveDropIndexFromY],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerOriginIndex.current === null) return
      const from = pointerOriginIndex.current
      const to = resolveDropIndexFromY(e.clientY) ?? from
      if (from !== to) {
        const next = reorder(orderedAssets, from, to)
        setOrderedAssets(next)
        persistOrder(next)
      }
      pointerOriginIndex.current = null
      setTouchDraggingIndex(null)
      setTouchDropIndex(null)
    },
    [orderedAssets, persistOrder, resolveDropIndexFromY],
  )

  // ── Keyboard reorder ──────────────────────────────────────────────────────

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [keyboardGrabbed, setKeyboardGrabbed] = useState(false)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
      const { key } = e

      if (key === ' ' || key === 'Enter') {
        e.preventDefault()
        if (!keyboardGrabbed) {
          setKeyboardGrabbed(true)
          setFocusedIndex(index)
        } else {
          // Release — order already updated by arrow keys
          setKeyboardGrabbed(false)
        }
        return
      }

      if (key === 'Escape') {
        setKeyboardGrabbed(false)
        return
      }

      if (!keyboardGrabbed) return

      if (key === 'ArrowUp' || key === 'ArrowLeft') {
        e.preventDefault()
        if (index > 0) {
          const next = reorder(orderedAssets, index, index - 1)
          setOrderedAssets(next)
          persistOrder(next)
          setFocusedIndex(index - 1)
          // Move DOM focus to follow the item
          requestAnimationFrame(() => {
            itemRefs.current[index - 1]?.focus()
          })
        }
        return
      }

      if (key === 'ArrowDown' || key === 'ArrowRight') {
        e.preventDefault()
        if (index < orderedAssets.length - 1) {
          const next = reorder(orderedAssets, index, index + 1)
          setOrderedAssets(next)
          persistOrder(next)
          setFocusedIndex(index + 1)
          requestAnimationFrame(() => {
            itemRefs.current[index + 1]?.focus()
          })
        }
      }
    },
    [keyboardGrabbed, orderedAssets, persistOrder],
  )

  // ── Skeleton pass-through ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        {[1, 2, 3].map((i) => (
          <AssetCard key={`skeleton-${i}`} isLoading={true} />
        ))}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const reduced = prefersReducedMotion()

  return (
    <div
      className="grid lg:grid-cols-3 gap-6 mb-8"
      role="list"
      aria-label="Portfolio assets — drag or use arrow keys to reorder"
    >
      {orderedAssets.map((asset, index) => {
        const isDragging =
          draggingIndex === index || touchDraggingIndex === index
        const isDropTarget =
          (dropTargetIndex === index && draggingIndex !== index) ||
          (touchDropIndex === index && touchDraggingIndex !== index && touchDraggingIndex !== null)
        const isGrabbed = keyboardGrabbed && focusedIndex === index

        const row = prices[asset.name]
        const priceCard = row
          ? {
              price: row.price,
              change: row.change,
              source: row.source,
              quoteAgeSeconds: row.quoteAgeSeconds,
              servedFromCache: row.servedFromCache,
              dataTier: row.dataTier,
            }
          : undefined

        return (
          <div
            key={asset.name}
            ref={(el) => {
              itemRefs.current[index] = el
            }}
            role="listitem"
            // Accessibility
            tabIndex={0}
            aria-label={`${asset.name} — position ${index + 1} of ${orderedAssets.length}. ${
              isGrabbed
                ? 'Grabbed. Use arrow keys to move, Enter or Space to release.'
                : 'Press Enter or Space to grab and reorder with arrow keys.'
            }`}
            aria-grabbed={isGrabbed}
            // HTML5 drag
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnter={(e) => handleDragEnter(e, index)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            // Touch / pointer drag
            onPointerDown={(e) => handlePointerDown(e, index)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            // Keyboard
            onKeyDown={(e) => handleKeyDown(e, index)}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => {
              if (!keyboardGrabbed) setFocusedIndex(null)
            }}
            style={{
              cursor: isDragging ? 'grabbing' : 'grab',
              opacity: isDragging && !reduced ? 0.45 : 1,
              transition: reduced ? undefined : 'opacity 0.15s ease, transform 0.15s ease',
              transform:
                !reduced && isDropTarget
                  ? 'scale(1.02)'
                  : undefined,
              touchAction: 'none', // required for pointer capture on touch
            }}
            className={[
              'rounded-xl focus-visible:outline-none',
              isGrabbed
                ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900'
                : 'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900',
              isDropTarget && !reduced
                ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-900'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <AssetCard asset={asset} price={priceCard} />
          </div>
        )
      })}
    </div>
  )
}

export default AssetList
