import { useEffect, useState } from "react";

/**
 * React hook that tracks the state of a CSS media query.
 *
 * @param query - CSS media query string to match (e.g. "(prefers-reduced-motion: reduce)")
 * @returns boolean indicating whether the media query currently matches
 *
 * @example
 * ```tsx
 * const isLargeScreen = useMediaQuery("(min-width: 1024px)");
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    const listener = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQueryList.addEventListener("change", listener);
    setMatches(mediaQueryList.matches);

    return () => {
      mediaQueryList.removeEventListener("change", listener);
    };
  }, [query]);

  return matches;
}
