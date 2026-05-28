# Demo Walkthrough

> A step-by-step visual guide to trying Stellar Portfolio Rebalancer.

You can explore the platform with the **$10,000 demo mode** without connecting a wallet. This walkthrough shows the main user journey from landing page to portfolio overview and rebalancing.

---

## 1. Landing Page

When you open the app, you land on the **Landing page** which features:

- A hero section with the **"Start Free Trial"** and **"Connect Wallet"** call-to-action buttons
- Three feature cards: **Smart Rebalancing**, **Multi-Wallet Support**, and **Real-Time Price Feeds**
- A **wallet connection flow** that supports Freighter, Rabet, xBull, and other Stellar wallets
- A **dark/light theme toggle** in the top navigation bar

![Landing page with hero, feature cards, and navigation](/.github/screenshots/landing.png)

> 💡 **Tip:** Click **"Start Free Trial"** to explore the full interface with a simulated $10,000 portfolio. No wallet required.

---

## 2. Wallet Connection (Optional)

If you have a Stellar wallet:

1. Click **"Connect Wallet"** in the top-right or hero area
2. A wallet selector modal appears — choose **Freighter**, **Rabet**, **xBull**, or **Albedo**
3. Follow your wallet's prompt to approve the connection
4. After connecting, your public key appears in the navigation bar

If you do not have a wallet yet:

- Install [Freighter](https://freighter.app/) (Chrome extension)
- Fund your testnet account via the [Stellar Lab](https://laboratory.stellar.org/#account-creator?network=testnet)

![Wallet selector modal with Freighter, Rabet, xBull options](/.github/screenshots/wallet-selector.png)

---

## 3. Dashboard — Portfolio Overview

After connecting or starting the trial, you see the **Dashboard**:

- **Portfolio value** and **asset allocation** shown as a donut chart or bar graph
- **Active rebalancing positions** listed with current vs. target allocation percentages
- **Drift indicators** highlight assets that have deviated from their target
- **Recent transactions** or rebalancing history timeline

Key metrics displayed:
- Total portfolio value
- Number of assets tracked
- Pending rebalancing actions
- Last price update timestamp

![Dashboard with portfolio chart, allocation table, and key metrics](/.github/screenshots/dashboard.png)

---

## 4. Creating a Rebalancing Strategy

To set up automatic rebalancing:

1. Navigate to the **Strategies** section via the sidebar
2. Click **"Create Strategy"**
3. Configure the following:

| Setting | Options | Description |
|---------|---------|-------------|
| Name | Free text | A label for your strategy (e.g., "60/40 Crypto Bonds") |
| Assets | Multi-select | Choose which assets to include |
| Target allocation | Percentage per asset | E.g., 50% XLM, 30% USDC, 20% ETH (via Stellar Assets) |
| Drift threshold | 1%–10% | How far an allocation can drift before rebalancing triggers |
| Rebalance interval | Manual, Daily, Weekly | How often to check for rebalancing opportunities |

4. Click **"Save Strategy"** to activate it

![Strategy creation form with asset selection and allocation inputs](/.github/screenshots/create-strategy.png)

---

## 5. Monitoring & Manual Rebalance

Once your strategy is active:

- The **Dashboard** shows real-time allocation vs. target
- Assets exceeding the drift threshold are highlighted with a warning badge
- Click **"Rebalance Now"** to trigger an immediate rebalance
- A confirmation prompt shows the trades that will be executed

After rebalancing:
- A success notification appears
- The portfolio chart updates to show the new allocation
- A transaction log entry is created

![Rebalancing confirmation showing trades to execute](/.github/screenshots/rebalance-confirm.png)

---

## 6. Settings & Configuration

Access the **Settings** page to configure:

- **Default drift threshold** for new strategies
- **Gas / fee budget** for on-chain transactions
- **Notification preferences** (off-chain only for now)
- **Data refresh interval** (poll rate for price updates)

![Settings page with configuration options](/.github/screenshots/settings.png)

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "No wallet detected" | Wallet extension not installed | Install Freighter/Rabet/xBull |
| "Demo mode only" on connect | Network mismatch | Switch to testnet in wallet |
| Stale portfolio data | Price feed lag | Wait for next poll cycle or refresh manually |
| "Strategy not saving" | Missing allocation totals 100% | Ensure all asset percentages sum to 100 |

---

## Demo Mode

The **$10,000 simulated portfolio** lets you:

- Create and test rebalancing strategies without real funds
- See how drift thresholds trigger rebalancing
- Explore the full UI without a Stellar wallet
- Evaluate performance before going live

To exit demo mode at any time, connect a real wallet from the navigation menu.

---

## Next Steps

- Read the [Contributing Guide](CONTRIBUTING.md) to set up a local dev environment
- Check the [FAQ](./docs/FAQ.md) for common questions
- Explore [open issues](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues) to contribute
