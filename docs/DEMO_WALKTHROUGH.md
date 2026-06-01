# Demo Walkthrough

This visual guide walks you through the main features of the Stellar Portfolio Rebalancer platform. Follow along to understand the user journey from wallet connection to portfolio management.

---

## Table of Contents

1. [Landing Page](#1-landing-page)
2. [Wallet Connection](#2-wallet-connection)
3. [Dashboard Overview](#3-dashboard-overview)
4. [Creating a Portfolio](#4-creating-a-portfolio)
5. [Portfolio Details](#5-portfolio-details)
6. [Executing a Rebalance](#6-executing-a-rebalance)
7. [Rebalance History](#7-rebalance-history)
8. [Notification Preferences](#8-notification-preferences)

---

## 1. Landing Page

**What you see:**
- Clean, modern interface introducing the platform
- Key features highlighted: Smart Rebalancing, Risk Management, Real-time Oracle Data
- Call-to-action buttons for connecting wallet or viewing demo

**Key Elements:**
- **Connect Wallet** button (top right) - Primary entry point for authenticated users
- **View Demo** button - Explore with $10,000 simulated portfolio
- Feature cards explaining platform capabilities
- Footer with legal links (Terms, Privacy, Cookies)

**User Actions:**
- Click "Connect Wallet" to authenticate with your Stellar wallet
- Click "View Demo" to explore without connecting a wallet
- Toggle dark/light theme using the theme switcher

**Screenshot Location:** `docs/screenshots/01-landing-page.png`

> **Note:** Screenshots will be added in a follow-up PR. For now, you can generate them by running the application locally and capturing screens at each step.

---

## 2. Wallet Connection

**What you see:**
- Wallet selector modal with supported wallet options
- Freighter, Rabet, xBull, and other Stellar wallets
- Clear instructions for each wallet type

**Key Elements:**
- Wallet icons and names
- "Install" links for wallets not yet installed
- Error messages if wallet connection fails
- Privacy consent flow (if enabled)

**User Actions:**
- Select your preferred Stellar wallet
- Approve the connection request in your wallet extension
- Accept privacy consent if prompted
- Automatically redirected to dashboard upon successful connection

**Common Issues:**
- **Wallet not detected:** Install the wallet extension and refresh the page
- **Connection rejected:** Check wallet settings and try again
- **Wrong network:** Ensure your wallet is set to Testnet (for testing) or Mainnet (for production)

**Screenshot Location:** `docs/screenshots/02-wallet-connection.png`

---

## 3. Dashboard Overview

**What you see:**
- Portfolio summary cards showing total value and allocation
- List of your portfolios (or empty state if none created)
- Quick actions: Create Portfolio, View History, Settings
- Real-time price data for your assets

**Key Elements:**
- **Total Portfolio Value:** Aggregate value across all portfolios
- **Asset Allocation Chart:** Visual breakdown of your holdings
- **Portfolio Cards:** Individual portfolio summaries with key metrics
- **Recent Activity:** Latest rebalances and transactions

**User Actions:**
- Click "Create Portfolio" to set up a new portfolio
- Click on a portfolio card to view details
- View rebalance history and performance metrics
- Access notification settings

**Demo Mode:**
- If not connected, you'll see a simulated $10,000 portfolio
- All features are functional but transactions are simulated
- Banner indicates demo mode is active

**Screenshot Location:** `docs/screenshots/03-dashboard.png`

---

## 4. Creating a Portfolio

**What you see:**
- Multi-step portfolio creation form
- Asset selection with search and filtering
- Allocation sliders or input fields
- Strategy selection and configuration

**Key Elements:**

### Step 1: Basic Information
- Portfolio name (e.g., "Conservative Growth")
- Optional description

### Step 2: Asset Selection
- Search bar for finding assets (XLM, USDC, BTC, etc.)
- Maximum 10 assets per portfolio
- Asset details: current price, 24h change, market cap

### Step 3: Target Allocation
- Percentage sliders for each asset
- Must sum to exactly 100%
- Visual pie chart preview
- Validation messages if allocations are invalid

### Step 4: Rebalancing Strategy
- **Threshold-based:** Rebalance when drift exceeds X%
- **Periodic:** Rebalance every N days
- **Volatility-based:** Rebalance on market volatility
- **Custom:** Combine multiple conditions

### Step 5: Configuration
- Rebalance threshold (1-50%)
- Automatic rebalancing toggle
- Risk settings: concentration limits, cooldown period

**User Actions:**
- Fill in portfolio details
- Select 2-10 assets
- Set target allocations (must sum to 100%)
- Choose rebalancing strategy
- Configure thresholds and settings
- Review and submit transaction

**Validation Rules:**
- Allocations must sum to 100%
- Threshold must be between 1% and 50%
- At least 2 assets required
- Maximum 10 assets allowed

**Screenshot Locations:**
- `docs/screenshots/04a-create-portfolio-assets.png`
- `docs/screenshots/04b-create-portfolio-allocation.png`
- `docs/screenshots/04c-create-portfolio-strategy.png`

---

## 5. Portfolio Details

**What you see:**
- Comprehensive portfolio overview
- Current vs. target allocation comparison
- Performance metrics and charts
- Rebalance status and history

**Key Elements:**

### Portfolio Header
- Portfolio name and total value
- Last rebalance date
- Auto-rebalance status (enabled/disabled)
- Edit and delete buttons

### Allocation View
- **Current Allocation:** Actual asset distribution based on current prices
- **Target Allocation:** Your desired distribution
- **Drift Indicators:** Visual indicators showing how far each asset has drifted
- Color coding: Green (within threshold), Yellow (approaching threshold), Red (exceeds threshold)

### Performance Metrics
- Total return ($ and %)
- 24h change
- 7-day change
- Since inception performance

### Asset Details Table
| Asset | Current % | Target % | Drift | Value | Action Needed |
|-------|-----------|----------|-------|-------|---------------|
| XLM   | 42%       | 40%      | +2%   | $4,200 | None |
| USDC  | 33%       | 35%      | -2%   | $3,300 | None |
| BTC   | 25%       | 25%      | 0%    | $2,500 | None |

### Rebalance Status
- **In Threshold:** No action needed
- **Approaching Threshold:** Rebalance recommended soon
- **Exceeds Threshold:** Rebalance needed now
- **Cooldown Active:** Next rebalance available in X hours

**User Actions:**
- Click "Rebalance Now" to execute manual rebalance
- Toggle auto-rebalance on/off
- Edit portfolio settings
- View detailed rebalance plan before executing
- Delete portfolio (with confirmation)

**Screenshot Location:** `docs/screenshots/05-portfolio-details.png`

---

## 6. Executing a Rebalance

**What you see:**
- Rebalance plan preview
- Detailed trade breakdown
- Estimated fees and slippage
- Confirmation modal

**Key Elements:**

### Rebalance Plan
- **Trades Required:** List of buy/sell orders needed
- **Estimated Slippage:** Expected price impact
- **Transaction Fees:** Stellar network fees (typically < $0.01)
- **Expected Outcome:** Projected allocation after rebalance

### Trade Breakdown Example
```
Sell 150 XLM → USDC (reduce from 42% to 40%)
Buy 50 USDC worth of BTC (increase from 23% to 25%)
```

### Safety Checks
- ✅ Within concentration limits
- ✅ Cooldown period satisfied
- ✅ Volatility within acceptable range
- ✅ Sufficient balance for fees

### Confirmation Modal
- Review all trades
- Estimated completion time
- "Confirm Rebalance" button
- "Cancel" option

**User Actions:**
1. Review the rebalance plan carefully
2. Check estimated fees and slippage
3. Click "Confirm Rebalance"
4. Approve transaction in your wallet
5. Wait for confirmation (typically 5-10 seconds on Stellar)
6. View updated portfolio allocation

**Transaction Flow:**
1. **Initiated:** Rebalance request submitted
2. **Pending:** Waiting for blockchain confirmation
3. **Executing:** Trades being executed on Stellar DEX
4. **Completed:** All trades successful, portfolio rebalanced
5. **Failed:** Error occurred (with details and retry option)

**Screenshot Locations:**
- `docs/screenshots/06a-rebalance-plan.png`
- `docs/screenshots/06b-rebalance-confirmation.png`
- `docs/screenshots/06c-rebalance-executing.png`

---

## 7. Rebalance History

**What you see:**
- Chronological list of all rebalances
- Detailed view of each rebalance event
- Performance impact analysis

**Key Elements:**

### History Table
| Date | Type | Assets Traded | Fees | Outcome | Details |
|------|------|---------------|------|---------|---------|
| 2024-01-15 | Auto | XLM, USDC, BTC | $0.003 | Success | View |
| 2024-01-08 | Manual | XLM, USDC | $0.002 | Success | View |
| 2024-01-01 | Auto | All | $0.004 | Partial | View |

### Rebalance Details
- **Trigger:** What caused the rebalance (threshold exceeded, manual, scheduled)
- **Trades Executed:** Complete list of buy/sell orders
- **Actual Slippage:** Real slippage vs. estimated
- **Gas Fees:** Total transaction costs
- **Before/After Allocation:** Visual comparison
- **Performance Impact:** How the rebalance affected portfolio value

### Filters and Search
- Filter by date range
- Filter by type (auto/manual)
- Filter by outcome (success/failed/partial)
- Search by asset

**User Actions:**
- Click on any rebalance to view full details
- Export history to CSV
- Analyze rebalance effectiveness
- Identify patterns and optimize strategy

**Screenshot Location:** `docs/screenshots/07-rebalance-history.png`

---

## 8. Notification Preferences

**What you see:**
- Notification settings panel
- Email and webhook configuration
- Event type selection

**Key Elements:**

### Notification Channels
- **Email Notifications:** Enter email address
- **Webhook Notifications:** Enter webhook URL for programmatic alerts

### Event Types
- ☑️ **Rebalance Completed:** Notified when rebalance finishes
- ☑️ **Rebalance Failed:** Alerted if rebalance encounters errors
- ☑️ **Threshold Exceeded:** Warning when drift exceeds threshold
- ☑️ **Circuit Breaker Triggered:** Alert when safety mechanism activates
- ☑️ **Price Movement:** Notified of significant price changes
- ☑️ **Risk Changes:** Alerted to portfolio risk level changes

### Notification Frequency
- **Immediate:** Real-time notifications
- **Daily Digest:** Once per day summary
- **Weekly Summary:** Weekly portfolio report

**User Actions:**
- Enter email address or webhook URL
- Select which events to receive notifications for
- Choose notification frequency
- Test notifications with "Send Test" button
- Save preferences

**Privacy Note:**
- Email addresses are stored securely
- Unsubscribe link included in all emails
- Webhook URLs are validated before saving
- See [Privacy Policy](../PRIVACY_POLICY.md) for details

**Screenshot Location:** `docs/screenshots/08-notification-settings.png`

---

## Additional Features

### Dark Mode
- Toggle between light and dark themes
- Preference saved to browser localStorage
- Accessible via theme switcher in navigation

### Mobile Responsive
- Fully responsive design works on all screen sizes
- Touch-optimized controls for mobile devices
- Simplified navigation on smaller screens

### Accessibility
- WCAG 2.1 AA compliant
- Keyboard navigation support
- Screen reader compatible
- High contrast mode available

---

## Demo Mode Details

When using the platform without connecting a wallet:

**What's Simulated:**
- $10,000 starting portfolio value
- Real-time price data (actual market prices)
- Rebalance calculations and plans
- Transaction execution (no real blockchain transactions)

**What's Real:**
- User interface and navigation
- Portfolio creation and management
- Rebalance logic and algorithms
- Notification system (test mode)

**Limitations:**
- Cannot execute real blockchain transactions
- Portfolio data not persisted (resets on page refresh)
- Some features disabled (e.g., real wallet integration)

**Banner Indicator:**
- "Demo Mode" banner visible at top of page
- "Connect Wallet for Real Trading" call-to-action

---

## Generating Screenshots

To generate screenshots for this walkthrough:

### Prerequisites
```bash
cd frontend
npm install
npm run dev
```

### Screenshot Checklist

1. **Landing Page** (`01-landing-page.png`)
   - Navigate to http://localhost:3000
   - Capture full page in light mode
   - Capture full page in dark mode (optional)

2. **Wallet Connection** (`02-wallet-connection.png`)
   - Click "Connect Wallet"
   - Capture wallet selector modal

3. **Dashboard** (`03-dashboard.png`)
   - Connect wallet or use demo mode
   - Capture dashboard with at least one portfolio

4. **Create Portfolio - Assets** (`04a-create-portfolio-assets.png`)
   - Click "Create Portfolio"
   - Capture asset selection step

5. **Create Portfolio - Allocation** (`04b-create-portfolio-allocation.png`)
   - Proceed to allocation step
   - Capture with sliders and pie chart

6. **Create Portfolio - Strategy** (`04c-create-portfolio-strategy.png`)
   - Proceed to strategy selection
   - Capture strategy options

7. **Portfolio Details** (`05-portfolio-details.png`)
   - Open an existing portfolio
   - Capture full details view with allocation chart

8. **Rebalance Plan** (`06a-rebalance-plan.png`)
   - Click "Rebalance Now"
   - Capture rebalance plan preview

9. **Rebalance Confirmation** (`06b-rebalance-confirmation.png`)
   - Proceed to confirmation
   - Capture confirmation modal

10. **Rebalance Executing** (`06c-rebalance-executing.png`)
    - Confirm rebalance
    - Capture loading/executing state

11. **Rebalance History** (`07-rebalance-history.png`)
    - Navigate to history page
    - Capture with multiple rebalance entries

12. **Notification Settings** (`08-notification-settings.png`)
    - Open settings/notifications
    - Capture preferences panel

### Screenshot Guidelines

- **Resolution:** 1920x1080 (desktop), 375x812 (mobile)
- **Format:** PNG with transparency where applicable
- **Annotations:** Add arrows or highlights for key elements (optional)
- **Privacy:** Blur or redact any real wallet addresses or personal data
- **Consistency:** Use the same theme (light/dark) across all screenshots
- **File Size:** Optimize images (< 500KB each) using tools like TinyPNG

### Tools for Screenshots

- **Browser DevTools:** Built-in screenshot tools (F12 → Cmd/Ctrl+Shift+P → "Capture screenshot")
- **Browser Extensions:** Awesome Screenshot, Nimbus Screenshot
- **Desktop Tools:** Snagit, Greenshot, macOS Screenshot (Cmd+Shift+4)
- **Automated:** Playwright or Puppeteer for consistent screenshots

---

## Next Steps

After completing this walkthrough, you should understand:

✅ How to connect your Stellar wallet  
✅ How to create and configure a portfolio  
✅ How to monitor allocation drift  
✅ How to execute manual and automatic rebalances  
✅ How to review rebalance history and performance  
✅ How to configure notifications  

**Ready to get started?**

1. **For Testing:** Use the demo mode to explore without risk
2. **For Real Trading:** Connect your wallet and start with a small portfolio
3. **For Development:** See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions

**Need Help?**

- 📚 [Full Documentation](../README.md)
- 💬 [Community Discussions](https://github.com/ritik4ever/stellar-portfolio-rebalancer/discussions)
- 🐛 [Report Issues](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/new/choose)
- 📧 [Contact Support](mailto:support@example.com)

---

## Maintenance Notes

**Screenshot Updates Required When:**
- Major UI redesign or rebranding
- New features added to main user flows
- Significant changes to navigation or layout
- Wallet integration changes

**Review Schedule:** Quarterly or after major releases

**Last Updated:** [Date]  
**Screenshots Status:** Pending (to be added in follow-up PR)  
**Next Review:** [Date + 3 months]
