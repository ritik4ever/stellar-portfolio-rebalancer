import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_SOCIAL_DESCRIPTION,
  DEFAULT_SOCIAL_META,
  DEFAULT_SOCIAL_TITLE,
  SOCIAL_IMAGE_HEIGHT,
  SOCIAL_IMAGE_TYPE,
  SOCIAL_IMAGE_WIDTH,
  SOCIAL_SITE_NAME,
  applySocialMeta,
  buildSocialMeta,
  removeSocialMeta,
  toAbsoluteUrl,
} from './socialMeta'

function content(property: string): string | null {
  const attribute = property.startsWith('twitter:') ? 'name' : 'property'
  return document.querySelector(`meta[${attribute}="${property}"]`)?.getAttribute('content') ?? null
}

describe('toAbsoluteUrl', () => {
  it('joins an origin with a path', () => {
    expect(toAbsoluteUrl('/api/v1/x.png', 'https://api.example.com')).toBe('https://api.example.com/api/v1/x.png')
    expect(toAbsoluteUrl('api/v1/x.png', 'https://api.example.com/')).toBe('https://api.example.com/api/v1/x.png')
  })

  it('leaves absolute URLs and path-only values alone', () => {
    expect(toAbsoluteUrl('https://cdn.example.com/x.png', 'https://api.example.com')).toBe('https://cdn.example.com/x.png')
    expect(toAbsoluteUrl('/api/v1/x.png')).toBe('/api/v1/x.png')
    expect(toAbsoluteUrl('')).toBe('')
  })
})

describe('buildSocialMeta', () => {
  it('omits url and image tags when they are unknown', () => {
    const tags = buildSocialMeta({ title: 'T', description: 'D' })

    expect(tags['og:title']).toBe('T')
    expect(tags['og:type']).toBe('website')
    expect(tags['og:site_name']).toBe(SOCIAL_SITE_NAME)
    expect(tags['twitter:card']).toBe('summary')
    expect(tags['og:url']).toBeUndefined()
    expect(tags['og:image']).toBeUndefined()
  })

  it('describes a large-image card and keeps twitter tags in sync', () => {
    const tags = buildSocialMeta({
      title: 'Alpha Fund — $100,000',
      description: 'Shared portfolio with 3 assets.',
      url: 'https://app.example.com/public/abc123',
      imageUrl: 'https://api.example.com/api/v1/portfolio/share/abc123/og.png',
      imageAlt: 'Alpha Fund card',
    })

    expect(tags['og:url']).toBe('https://app.example.com/public/abc123')
    expect(tags['og:image']).toBe('https://api.example.com/api/v1/portfolio/share/abc123/og.png')
    expect(tags['og:image:width']).toBe(String(SOCIAL_IMAGE_WIDTH))
    expect(tags['og:image:height']).toBe(String(SOCIAL_IMAGE_HEIGHT))
    expect(tags['og:image:type']).toBe(SOCIAL_IMAGE_TYPE)
    expect(tags['og:image:secure_url']).toBe(tags['og:image'])
    expect(tags['og:image:alt']).toBe('Alpha Fund card')
    expect(tags['twitter:card']).toBe('summary_large_image')
    expect(tags['twitter:title']).toBe(tags['og:title'])
    expect(tags['twitter:description']).toBe(tags['og:description'])
    expect(tags['twitter:image']).toBe(tags['og:image'])
  })

  it('skips the secure URL for plain http cards and alt text when absent', () => {
    const tags = buildSocialMeta({
      title: 'T',
      description: 'D',
      imageUrl: 'http://localhost:3001/api/v1/portfolio/share/abc/og.png',
    })

    expect(tags['og:image:secure_url']).toBeUndefined()
    expect(tags['og:image:alt']).toBeUndefined()
    expect(tags['twitter:image:alt']).toBeUndefined()
  })
})

describe('applySocialMeta', () => {
  beforeEach(() => {
    removeSocialMeta()
    document.title = SOCIAL_SITE_NAME
  })

  it('writes every managed tag and the document title', () => {
    applySocialMeta({
      title: 'Alpha Fund — $100,000',
      description: 'Shared portfolio with 3 assets.',
      imageUrl: 'https://api.example.com/card.png',
      documentTitle: 'Alpha Fund — $100,000 | Stellar Portfolio Rebalancer',
    })

    expect(content('og:title')).toBe('Alpha Fund — $100,000')
    expect(content('twitter:card')).toBe('summary_large_image')
    expect(document.title).toBe('Alpha Fund — $100,000 | Stellar Portfolio Rebalancer')
  })

  it('replaces tags left over from a previous page', () => {
    applySocialMeta({
      title: 'First',
      description: 'First description',
      imageUrl: 'https://api.example.com/first.png',
    })
    applySocialMeta({ title: DEFAULT_SOCIAL_TITLE, description: DEFAULT_SOCIAL_DESCRIPTION })

    expect(content('og:title')).toBe(DEFAULT_SOCIAL_TITLE)
    expect(content('og:image')).toBeNull()
    expect(content('twitter:card')).toBe('summary')
  })

  it('removes every managed tag', () => {
    applySocialMeta({ title: 'T', description: 'D', imageUrl: 'https://api.example.com/card.png' })
    removeSocialMeta()

    expect(document.querySelector('meta[property^="og:"]')).toBeNull()
    expect(document.querySelector('meta[name^="twitter:"]')).toBeNull()
    expect(DEFAULT_SOCIAL_META.title).toBe(DEFAULT_SOCIAL_TITLE)
  })

  it('clears tags shipped by index.html that use the other attribute spelling', () => {
    const shipped = document.createElement('meta')
    shipped.setAttribute('property', 'twitter:card')
    shipped.setAttribute('content', 'summary')
    document.head.appendChild(shipped)

    removeSocialMeta()

    expect(document.querySelector('meta[property="twitter:card"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:card"]')).toBeNull()
  })
})