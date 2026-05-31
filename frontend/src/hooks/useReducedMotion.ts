import { useMediaQuery } from "./useMediaQuery";

/**
 * Returns true when the user prefers reduced motion.
 * Components can use this to disable animations, transitions,
 * and auto-scrolling behavior when the user has indicated
 * they want less motion.
 *
 * @example
 * ```tsx
 * const prefersReducedMotion = useReducedMotion();
 * return (
 *   <div className={prefersReducedMotion ? 'no-animation' : 'animated'}>
 *     {content}
 *   </div>
 * );
 * ```
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
