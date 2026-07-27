/**
 * Persists and retrieves the user-defined asset display order per portfolio.
 *
 * Order is stored in localStorage under a versioned, portfolio-scoped key.
 * The stored value is an ordered array of asset names (symbols). Assets not
 * present in the stored order (newly added) are appended at the end.
 */

const ASSET_ORDER_VERSION = 1

function storageKey(portfolioId: string): string {
  return `asset-order-v${ASSET_ORDER_VERSION}-${portfolioId}`
}

/**
 * Loads the saved order for `portfolioId`. Returns `null` when nothing is
 * stored or the value cannot be parsed.
 */
export function loadAssetOrder(portfolioId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(portfolioId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Saves the given ordered asset-name array for `portfolioId`.
 */
export function saveAssetOrder(portfolioId: string, order: string[]): void {
  try {
    window.localStorage.setItem(storageKey(portfolioId), JSON.stringify(order))
  } catch {
    // localStorage may be full or unavailable — silently ignore
  }
}

/**
 * Applies the persisted order to `assets`, appending any new assets that are
 * not yet in the saved order. Returns a new array — original is unchanged.
 */
export function applyAssetOrder<T extends { name: string }>(
  assets: T[],
  savedOrder: string[] | null,
): T[] {
  if (!savedOrder || savedOrder.length === 0) return assets

  const byName = new Map(assets.map((a) => [a.name, a]))
  const ordered: T[] = []

  for (const name of savedOrder) {
    const asset = byName.get(name)
    if (asset) {
      ordered.push(asset)
      byName.delete(name)
    }
  }

  // Append any assets not covered by the saved order
  for (const remaining of byName.values()) {
    ordered.push(remaining)
  }

  return ordered
}
