Closes #998

## Summary

Implements a 5-step **Portfolio Rebalancing Wizard** at `frontend/src/pages/PortfolioWizard.tsx` that guides users through every stage of portfolio creation — from template selection to Freighter wallet signing — while preserving all entered data during back/forward navigation.

---

## What was added

### New file: `frontend/src/pages/PortfolioWizard.tsx`

A self-contained, mobile-responsive wizard page with 5 numbered steps:

| Step | Description |
|------|-------------|
| **Step 1 – Select Template** | Choose from Conservative Growth, Balanced Growth, Aggressive Alt, or Custom. Selecting a template pre-fills allocations. |
| **Step 2 – Set Allocations** | Add/remove Stellar assets with the existing `AssetSelector` component. Live `sum` indicator validates the total is exactly 100% before allowing navigation forward. |
| **Step 3 – Configure Rules** | Drift threshold slider (1–20%), cooldown period (hours), and an auto-rebalance toggle. |
| **Step 4 – Review & Sign** | Full summary of allocations and rules, wallet connection status, and a "Sign with Freighter" button. |
| **Step 5 – Success** | Confirms portfolio creation, shows portfolio ID, and offers a shareable public link with one-click copy. |

**Key acceptance criteria addressed:**
- ✅ Back/forward navigation preserves all entered data (single React state tree)
- ✅ Step indicator shows progress at all times
- ✅ Mobile-friendly across all steps (responsive flex/grid layout, full-width inputs on small screens)
- ✅ Live allocation sum validation with clear user feedback
- ✅ Freighter wallet signing via existing `walletManager.signTransaction`
- ✅ Share link generated and displayed on success

### New file: `frontend/src/pages/PortfolioWizard.test.tsx`

Comprehensive unit tests covering:
- Step 1 renders all template cards and advances to Step 2
- Step 2 shows live allocation sum and disables Next when total ≠ 100%
- Step 3 allows editing cooldown/threshold values
- Step 4 triggers `createPortfolioMutation` and generates share link on sign
- Step 5 shows portfolio ID and share link; "Go to Dashboard" navigates correctly
- Back/forward navigation preserves entered data

### Modified: `frontend/src/App.tsx`
- Imported `PortfolioWizard`
- Added `currentView === 'wizard'` render branch wrapped in `ErrorBoundary`

### Modified: `frontend/src/components/Dashboard.tsx`
- Added "✨ Wizard" button to the portfolio action bar to surface the new wizard page
