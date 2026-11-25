/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            screens: {
                // Narrowest supported viewport for the rebalance review/preview
                // layouts. Components can use `xs:` to opt into compact
                // single-column layouts that stay usable at 320px.
                xs: '320px',
            },
            minWidth: {
                // Prevent flex/grid children from collapsing below their
                // content width, which causes horizontal clipping at narrow
                // widths and with 200% text sizing.
                '0': '0px',
                'content': 'min-content',
                'fit': 'fit-content',
                'full': '100%',
            },
            maxWidth: {
                // Allow quoted trades, fees, and price-age blocks to shrink
                // within their containers instead of overflowing.
                'screen-xs': '320px',
            },
        },
    },
    plugins: [],
}