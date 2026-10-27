import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
}

if (typeof window !== 'undefined' && (!window.URL || !window.URL.createObjectURL)) {
  window.URL.createObjectURL = () => 'blob:mock-url'
  window.URL.revokeObjectURL = () => {}
}

// Ensure window and window.event are safely accessible if async React updates resolve post-teardown
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
if (typeof (globalThis as any).window.event === 'undefined') {
  (globalThis as any).window.event = null;
}
