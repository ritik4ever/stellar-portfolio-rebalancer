# Accessibility Audit

This document tracks the accessibility status of the Stellar Portfolio Rebalancer frontend.

## Landmarks Audit

The application should use semantic HTML landmarks to help screen readers navigate:

| Landmark | Used | Notes |
|----------|------|-------|
| `<header>` | ✅ | Main app header with navigation and theme toggle |
| `<nav>` | ✅ | Tab navigation and settings menu |
| `<main>` | ✅ | Main content area for each view |
| `<section>` | ✅ | Cards and detail panels |
| `<aside>` | ⚠️ | Use for sidebar info panels |
| `<footer>` | ❌ | Missing — add app footer with version and links |
| `<form>` | ✅ | Portfolio setup and settings forms |

## Headings Audit

| Heading Level | Used | Notes |
|---------------|------|-------|
| `<h1>` | ⚠️ | Only on landing page; use on all views |
| `<h2>` | ✅ | Section headers like "Overview", "Analytics" |
| `<h3>` | ✅ | Card titles and panel headers |
| `<h4>`+ | ⚠️ | Rare — add for deeply nested sections |

## Labels and ARIA

- All form inputs should have associated `<label>` elements ✅
- Interactive elements should have accessible names ✅
- Loading states should use `aria-busy` ✅
- Dynamic content updates should use `aria-live` regions ⚠️

## Color and Contrast

- All text should meet WCAG AA minimum contrast (4.5:1 for normal text, 3:1 for large) ✅
- Interactive elements should have visible focus indicators ⚠️
- Error states should not rely on color alone ✅

## Keyboard Navigation

- All interactive elements should be reachable by Tab ✅
- Focus order should follow visual layout ⚠️
- Custom components should handle Enter/Space key events ✅
- Escape key should close modals and panels ⚠️

## Screen Reader Testing

| Screen | Tested | Notes |
|--------|--------|-------|
| VoiceOver (macOS) | ⚠️ | Manual testing needed |
| NVDA (Windows) | ❌ | Not yet tested |
| TalkBack (Android) | ❌ | Not yet tested |

## Known Issues

1. **Footer landmark missing** — Add `<footer>` with version, privacy link, and copyright
2. **Skip-to-content link** — Add hidden link to jump to main content
3. **Chart accessibility** — Add `aria-label` and `role="img"` to chart containers
4. **Toast notifications** — Add `role="alert"` and `aria-live="polite"`

## Priority Fixes

### P0 (Must fix before release)
- Add skip-to-content navigation link
- Ensure all views have a unique `<h1>`
- Add `role="alert"` to toast/notification container

### P1 (Should fix)
- Add footer landmark
- Add chart `aria-label` descriptions
- Test with screen reader

### P2 (Nice to have)
- Add dark/light theme switch `aria-label`
- Add animation toggle for reduced-motion
- Add keyboard shortcut documentation
