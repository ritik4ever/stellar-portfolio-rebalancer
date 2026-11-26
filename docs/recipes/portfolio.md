# Portfolio Recipes

## Review a DCA amount after a language change

If the language changes while you are editing a DCA amount in the portfolio wizard,
the wizard keeps the entered amount and the rest of the schedule. Check the amount,
then either correct it or select **Confirm amount** before continuing to review and sign.
Confirming the amount does not create or submit a portfolio.
The schedule editor and review controls reflow at narrow viewport widths and
larger text sizes; the review displays the numeric amount used by the schedule.

The DCA amount is in funding token units, from 0.0000001 to 200000000,
with at most seven fractional digits. Enter the decimal separator shown beside
the field (for example, `0,0000001` in German); do not enter grouping separators.
The wizard validates the value without rounding and sends the corresponding
canonical numeric token amount, e.g. `0.0000001`.

## Keyboard and screen-reader accessibility for localized amount display

The DCA schedule editor in the portfolio wizard includes keyboard and screen-reader support:
- **Accessible names and descriptions**: The DCA amount input is associated with an accessible label, input helper guidance, and live formatted representation via `aria-describedby`.
- **Decimal comma and high-precision token amounts**: High-precision token values (up to 7 decimal places / stroop precision) are formatted with locale-sensitive decimal and grouping separators (such as decimal comma in German `de`).
- **Locale change announcements and focus management**: When language changes while editing the amount, an assertive alert and polite live-region announcement notify screen-reader users, and the field signals `aria-invalid="true"`. Keyboard users can review the amount, correct it, or activate **Confirm amount** to confirm and restore focus to the input.
- **Completing or abandoning the flow**: Keyboard users can traverse the flow using Tab and Enter, review scheduled amounts in canonical and localized formats, submit the transaction, or abandon the wizard at any time via the **Cancel** button or top **Abandon wizard** control.

## Create a Portfolio

```bash
curl -s -X POST http://localhost:3000/api/portfolios \
  -H "Content-Type: application/json" \
  -d '{"name": "My Balanced Portfolio", "assets": ["XLM", "USDC"]}' | jq .
```

## List Portfolios

```bash
curl -s http://localhost:3000/api/portfolios | jq .
```

## Get Portfolio Details

```bash
curl -s http://localhost:3000/api/portfolios/portfolio_123 | jq .
```
