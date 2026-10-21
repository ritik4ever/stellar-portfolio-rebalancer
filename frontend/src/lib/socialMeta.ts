/**
 * Open Graph / Twitter card tags for shared pages.
 *
 * `index.html` ships the defaults so crawlers that do not execute JavaScript
 * still resolve a title and description. `PublicPortfolio` overrides them per
 * portfolio and hands them back on unmount, so navigating away from a share
 * link cannot leave one portfolio's stats attached to the next page.
 */

export const SOCIAL_SITE_NAME = 'Stellar Portfolio Rebalancer'
export const DEFAULT_SOCIAL_TITLE = 'Stellar Portfolio Rebalancer — automated portfolio rebalancing'
export const DEFAULT_SOCIAL_DESCRIPTION =
  'Rebalance Stellar portfolios against Reflector oracle prices and share a read-only snapshot of your allocation.'

/** Must match `OG_IMAGE_WIDTH` / `OG_IMAGE_HEIGHT` in `backend/src/services/ogImage.ts`. */
export const SOCIAL_IMAGE_WIDTH = 1200
export const SOCIAL_IMAGE_HEIGHT = 630
export const SOCIAL_IMAGE_TYPE = 'image/png'

const MANAGED_PROPERTIES = [
  'og:title',
  'og:description',
  'og:type',
  'og:site_name',
  'og:url',
  'og:image',
  'og:image:secure_url',
  'og:image:width',
  'og:image:height',
  'og:image:type',
  'og:image:alt',
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
  'twitter:image:alt',
] as const

export const DEFAULT_SOCIAL_META = {
  title: DEFAULT_SOCIAL_TITLE,
  description: DEFAULT_SOCIAL_DESCRIPTION,
  documentTitle: SOCIAL_SITE_NAME,
} as const

export interface SocialMetaInput {
  title: string
  description: string
  /** Canonical URL of the shared page. */
  url?: string
  /** Absolute URL of the share card. */
  imageUrl?: string
  imageAlt?: string
  /** Applied to `document.title` when provided. */
  documentTitle?: string
}

/** Joins an origin and a path into an absolute URL; crawlers reject relative ones. */
export function toAbsoluteUrl(path: string, origin?: string): string {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  if (!origin) return path
  return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/** Pure tag map, so per-portfolio values can be asserted without touching the DOM. */
export function buildSocialMeta(input: SocialMetaInput): Record<string, string> {
  const tags: Record<string, string> = {
    'og:title': input.title,
    'og:description': input.description,
    'og:type': 'website',
    'og:site_name': SOCIAL_SITE_NAME,
    'twitter:card': input.imageUrl ? 'summary_large_image' : 'summary',
    'twitter:title': input.title,
    'twitter:description': input.description,
  }

  if (input.url) {
    tags['og:url'] = input.url
  }

  if (input.imageUrl) {
    const image = toAbsoluteUrl(input.imageUrl)
    tags['og:image'] = image
    tags['og:image:width'] = String(SOCIAL_IMAGE_WIDTH)
    tags['og:image:height'] = String(SOCIAL_IMAGE_HEIGHT)
    tags['og:image:type'] = SOCIAL_IMAGE_TYPE
    tags['twitter:image'] = image
    if (image.startsWith('https://')) {
      tags['og:image:secure_url'] = image
    }
    if (input.imageAlt) {
      tags['og:image:alt'] = input.imageAlt
      tags['twitter:image:alt'] = input.imageAlt
    }
  }

  return tags
}

/** Open Graph tags use `property`; Twitter tags are documented with `name`. */
function metaAttribute(key: string): 'name' | 'property' {
  return key.startsWith('twitter:') ? 'name' : 'property'
}

export function removeSocialMeta(): void {
  for (const key of MANAGED_PROPERTIES) {
    // Both spellings are matched so tags shipped by `index.html` are cleared too.
    const selector = `meta[property="${key}"], meta[name="${key}"]`
    for (const element of Array.from(document.querySelectorAll(selector))) {
      element.remove()
    }
  }
}

/** Replaces every managed tag, so nothing from a previous page can survive. */
export function applySocialMeta(input: SocialMetaInput): void {
  removeSocialMeta()
  for (const [key, content] of Object.entries(buildSocialMeta(input))) {
    const element = document.createElement('meta')
    element.setAttribute(metaAttribute(key), key)
    element.setAttribute('content', content)
    document.head.appendChild(element)
  }
  if (input.documentTitle) {
    document.title = input.documentTitle
  }
}