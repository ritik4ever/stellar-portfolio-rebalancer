import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

interface UseDialogFocusOptions {
    /** Called when the user presses Escape inside the dialog. */
    onClose: () => void
    /** Element to focus on open. Defaults to the first focusable control. */
    initialFocusRef?: RefObject<HTMLElement | null>
    /** Where focus goes on close if the element that opened the dialog is gone. */
    fallbackFocusRef?: RefObject<HTMLElement | null>
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el =>
            !el.hasAttribute('disabled') &&
            el.getAttribute('aria-hidden') !== 'true' &&
            !el.closest('[hidden]'),
    )
}

/**
 * Modal focus management: moves focus into the dialog on open, keeps Tab and
 * Shift+Tab inside it, closes on Escape, and returns focus to the opener on
 * close. If the opener was removed meanwhile (for example the control swapped
 * out after a wallet state change) focus goes to `fallbackFocusRef` instead of
 * being dropped on `<body>`.
 */
export function useDialogFocus(
    open: boolean,
    containerRef: RefObject<HTMLElement | null>,
    { onClose, initialFocusRef, fallbackFocusRef }: UseDialogFocusOptions,
): void {
    // The latest callback without re-running the effect (and re-capturing the
    // opener) every time its identity changes.
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    useEffect(() => {
        if (!open) return
        const container = containerRef.current
        if (!container) return

        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const initial = initialFocusRef?.current ?? focusableWithin(container)[0] ?? container
        initial.focus()

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation()
                onCloseRef.current()
                return
            }
            if (event.key !== 'Tab') return
            const items = focusableWithin(container)
            if (items.length === 0) {
                event.preventDefault()
                container.focus()
                return
            }
            const first = items[0]
            const last = items[items.length - 1]
            const active = document.activeElement
            if (!container.contains(active)) {
                event.preventDefault()
                first.focus()
            } else if (event.shiftKey && active === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && active === last) {
                event.preventDefault()
                first.focus()
            }
        }

        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            if (opener && opener.isConnected && !opener.hasAttribute('disabled')) {
                opener.focus()
            } else {
                fallbackFocusRef?.current?.focus()
            }
        }
        // initialFocusRef / fallbackFocusRef are stable refs.
    }, [open, containerRef])
}
