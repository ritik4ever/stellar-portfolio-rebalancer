# Dashboard mobile navigation: keyboard and screen-reader behaviour

Covers the navigation surfaces on `frontend/src/components/Dashboard.tsx`
(SPR-2026-088): the **Dashboard sections** nav (Overview / Analytics /
Notifications), the sticky **Portfolio quick actions** bar shown below the `md`
breakpoint including the demo reset dialog it opens, and the header **language
menu** (`LanguageSelector`).

## Accessible names for controls that appear twice

The header and the quick actions bar both render some actions, and CSS shows
only one at a time. They are named differently so they are never ambiguous
(and so tests can address each): header "Refresh data" / bar "Refresh portfolio
data", header "Reset demo portfolio" / bar "Reset demo data", header "Create
portfolio" / bar "New portfolio", header "Analytics" (link to the full page) /
section button "Analytics section". Each name still contains the visible text.

## Section navigation

- A `nav` landmark named "Dashboard sections" containing plain buttons. The
  current section carries `aria-current="true"`; selecting one announces
  "<Section> section shown" in a polite live region. Focus stays on the button.
- The buttons wrap (`flex-wrap`) instead of overflowing, and are at least 44px
  tall, so all three stay reachable at 320px width and with enlarged text.
- Section buttons are named "<Section> section" (visible text unchanged), so
  "Analytics section" is not confused with the header "Analytics" link.
- Without a connected wallet the Notifications section explains that a wallet
  is needed instead of rendering an empty panel (this also covers a wallet
  disconnecting while that section is open).

## Quick actions bar

- A `region` named "Portfolio quick actions".
- Controls whose visible text is hidden on narrow screens keep an accessible
  name: "New portfolio" (visible "New" appears from `sm`), and "Balanced" is
  visually hidden but still read (`sr-only sm:not-sr-only`).
- The day change is announced as "Up today: 1.20%" / "Down today: 2.50%", not
  only through colour and icon direction.
- The fixed bar can cover content when text is enlarged. The spacer under the
  page is sized to the measured bar height (minimum 80px), and the same height
  is reserved as `scroll-padding-bottom` while the bar is mounted so a focused
  control is never scrolled underneath it.
- Refreshing replaces the dashboard with the loading screen, which unmounts the
  button that was used. When the data returns, focus goes back to a Refresh
  control, unless the user has moved focus elsewhere in the meantime.

## Language menu

A menu button with `aria-haspopup`, `aria-expanded` and `aria-controls` to a
named menu; the active language has `aria-current`. Opening it (click, Enter,
Space or ArrowDown) moves focus onto the active language. ArrowUp / ArrowDown
(wrapping), Home and End move between languages, Escape closes it and returns
focus to the button, Tab or a press outside closes it without stealing focus.
It stays open, with focus where it was, while the wallet connects or
disconnects behind it.

## Demo reset dialog

Opened by "Reset demo portfolio" (`aria-haspopup="dialog"`), only without a wallet.

- `role="dialog"`, `aria-modal`, named by its title and described by its text.
- Focus moves to the primary action on open; Tab and Shift+Tab stay inside the
  dialog; Escape and Cancel close it; focus returns to the opener
  (`hooks/useDialogFocus.ts`, reusable for other modals).
- While the reset runs the buttons use `aria-disabled` rather than `disabled`
  so focus is not dropped on `<body>`; progress is announced ("Resetting demo
  portfolio") and Escape / Cancel are ignored until it finishes.

## Wallet state changes while navigating

When a wallet connects or disconnects the page announces "Wallet connected.
Portfolio actions updated." or "Wallet disconnected. Showing the demo
portfolio." (not on first render). If the reset dialog is open when a wallet
connects, it closes (the demo reset no longer applies) and any failure message
is dropped. The action-bar control that swaps meaning (Reset demo portfolio ↔
New portfolio) is the same DOM node, so keyboard focus stays on it.

## Tests

`frontend/src/components/Dashboard.mobileNav.test.tsx` and
`LanguageSelector.test.tsx` cover each behaviour above. jsdom has no layout, so 320px / 200% text is asserted through the wrap
and spacer contracts; check the real layout with the Playwright suites under `frontend/tests/a11y`
(`npm run test:e2e` in `frontend/`) and by hand at 320px with browser text zoom.
