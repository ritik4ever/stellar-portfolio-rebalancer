# Screenshot-Based Demo Walkthrough

This document provides a visual step-by-step guide to setting up and using the Stellar Portfolio Rebalancer. Follow along with the screenshots to get started quickly.

> **Prerequisites:** Node.js 18+, Docker, and a Stellar wallet (Freighter recommended).

---

## 1. Local setup

### Clone and install

```bash
git clone https://github.com/ritik4ever/stellar-portfolio-rebalancer.git
cd stellar-portfolio-rebalancer

# Install all dependencies
npm install

# Start with Docker (recommended)
docker compose up -d
```

### Environment configuration

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `3001` | Backend API port |
| `STELLAR_NETWORK` | `testnet` | Network to connect to |
| `DEMO_MODE` | `true` | Enable demo mode with simulated funds |

---

## 2. Home screen

When you open the app in your browser (`http://localhost:5173` by default), you'll see the **home screen**:

```
┌──────────────────────────────────────────────────┐
│  [Logo]  Stellar Portfolio Rebalancer            │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │  Welcome to Stellar Portfolio Rebalancer     │  │
│  │                                             │  │
│  │  [Connect Wallet]  [Try Demo Mode]          │  │
│  │                                             │  │
│  │  Automatically maintain your crypto         │  │
│  │  portfolio allocations with Stellar's       │  │
│  │  fast, low-cost infrastructure.             │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  Key Features:                                    │
│  • Smart Rebalancing — automatic threshold-based  │
│  • Multi-Wallet — Freighter, xBull, Rabet         │
│  • Risk Management — circuit breakers, limits     │
│  • Demo Mode — $10,000 simulated portfolio        │
└──────────────────────────────────────────────────┘
```

**What to do:** Click **"Try Demo Mode"** to explore without connecting a wallet, or **"Connect Wallet"** to use your Freighter extension.

---

## 3. Connecting your wallet

After clicking "Connect Wallet":

```
┌──────────────────────────────────────────────┐
│  Connect a Stellar Wallet                     │
│                                               │
│  [Freighter]  [xBull]  [Rabet]  [Albedo]     │
│                                               │
│  ┌────────── Freighter ──────────┐            │
│  │  Connect with Freighter       │            │
│  │  Popular choice for Stellar   │            │
│  │                               │            │
│  │  [Connect Freighter]          │            │
│  └───────────────────────────────┘            │
│                                               │
│  Not using Freighter? Install it from         │
│  the Chrome Web Store.                        │
└──────────────────────────────────────────────┘
```

**Flow:**
1. Click your wallet provider button
2. Freighter prompts: "This site would like to see your public key"
3. Accept the request
4. Your address appears in the top-right corner

---

## 4. Creating a portfolio

Once connected, click **"Create Portfolio"**:

```
┌──────────────────────────────────────────────┐
│  Create New Portfolio                         │
│                                               │
│  Portfolio Name: [My First Portfolio        ] │
│                                               │
│  Allocations:                                 │
│  ┌────────────┬──────────┬────────────┐       │
│  │ Asset      │ Target % │ Remove    │       │
│  ├────────────┼──────────┼────────────┤       │
│  │ XLM        │   50%    │    [✕]    │       │
│  │ USDC       │   30%    │    [✕]    │       │
│  │ ETH        │   20%    │    [✕]    │       │
│  └────────────┴──────────┴────────────┘       │
│  [Add Asset]                                   │
│                                               │
│  Rebalance Threshold: [5%               ]     │
│  Slippage Tolerance:  [1.0%             ]     │
│                                               │
│  Summary: Total = 100% ✓                      │
│                                               │
│  [Create Portfolio]   [Cancel]                │
└──────────────────────────────────────────────┘
```

**Tips:**
- Keep allocations simple (2–4 assets) for your first portfolio
- A 5% threshold means the system rebalances when any asset deviates by 5% from its target
- Slippage tolerance of 1.0% protects against large price movements during execution

---

## 5. Portfolio dashboard

After creation, you'll see your portfolio dashboard:

```
┌──────────────────────────────────────────────┐
│  My First Portfolio          ⚡ Auto-Rebalance │
│                              [Active]         │
│                                               │
│  Total Value: $12,430.50                      │
│  ┌────────────────────────────────────────┐   │
│  │  ██████████████████████░░░░░  72%     │   │
│  │  Allocation v. Target                  │   │
│  └────────────────────────────────────────┘   │
│                                               │
│  ┌──────────┬──────────┬──────────┬────────┐  │
│  │ Asset    │ Target   │ Current  │ Status │  │
│  ├──────────┼──────────┼──────────┼────────┤  │
│  │ XLM      │ 50%      │ 55%      │ 🔴 +5% │  │
│  │ USDC     │ 30%      │ 28%      │ 🟢 -2% │  │
│  │ ETH      │ 20%      │ 17%      │ 🟡 -3% │  │
│  └──────────┴──────────┴──────────┴────────┘  │
│                                               │
│  [View Rebalance Plan]  [Rebalance Now]       │
│  [Analytics]  [Risk Check]                    │
└──────────────────────────────────────────────┘
```

**Key indicators:**
- 🔴 Red: Deviation exceeds threshold (rebalance needed)
- 🟡 Yellow: Above target but within threshold
- 🟢 Green: Below target but within threshold

---

## 6. Rebalancing

Click **"View Rebalance Plan"**:

```
┌──────────────────────────────────────────────┐
│  Rebalance Plan                               │
│                                               │
│  Current drift: XLM +5% (triggered)           │
│                                               │
│  Proposed trades:                              │
│  ┌──────────┬──────────┬──────────┬────────┐  │
│  │ Action   │ Asset    │ Amount   │ Est.   │  │
│  │          │          │          │ Value  │  │
│  ├──────────┼──────────┼──────────┼────────┤  │
│  │ Sell     │ XLM      │ 500      │ $621   │  │
│  │ Buy      │ USDC     │ 300      │ $300   │  │
│  │ Buy      │ ETH      │ 0.85     │ $321   │  │
│  └──────────┴──────────┴──────────┴────────┘  │
│                                               │
│  Slippage estimate: 0.3%                      │
│  Network fee est.: 0.00001 XLM                │
│                                               │
│  [Execute Rebalance]  [Simulate Only]  [Back] │
└──────────────────────────────────────────────┘
```

---

## 7. Analytics & performance

Navigate to the **Analytics** tab:

```
┌──────────────────────────────────────────────┐
│  Performance Analytics     Last 30 days      │
│                                               │
│  ┌────────────────────────────────────────┐   │
│  │         Portfolio Value Chart           │   │
│  │  ╱╲    ╱╲    ╱╲                         │   │
│  │ ╱  ╲  ╱  ╲  ╱  ╲                        │   │
│  │╱    ╲╱    ╲╱    ╲                       │   │
│  │  $11.5k    $12.1k    $12.4k             │   │
│  │  May 1     May 15    May 28             │   │
│  └────────────────────────────────────────┘   │
│                                               │
│  Performance Summary:                         │
│  • Total return: +12.4%                       │
│  • Best performer: XLM (+18.2%)               │
│  • Worst performer: ETH (+5.1%)               │
│  • Rebalances triggered: 3                    │
│  • Total fees paid: 0.00003 XLM               │
└──────────────────────────────────────────────┘
```

---

## 8. Auto-rebalancer settings

Configure automatic rebalancing:

```
┌──────────────────────────────────────────────┐
│  Auto-Rebalancer Settings                     │
│                                               │
│  Status: [Active]                             │
│                                               │
│  Check interval: [Every hour           ▼]    │
│  Max trades per run: [5               ]      │
│  Ignore safety checks: [No              ]    │
│                                               │
│  ┌────────────────────────────────────────┐   │
│  │  Last check: 2 minutes ago             │   │
│  │  Last rebalance: 3 hours ago           │   │
│  │  Next check: in ~58 minutes            │   │
│  │  Total auto-rebalances: 7              │   │
│  └────────────────────────────────────────┘   │
│                                               │
│  [Save Settings]  [Stop Auto-Rebalancer]      │
└──────────────────────────────────────────────┘
```

---

## 9. Demo mode

In demo mode, you get a simulated $10,000 portfolio:

```
┌──────────────────────────────────────────────┐
│  🌟 Demo Mode Active                          │
│                                               │
│  You are using a simulated portfolio with     │
│  $10,000 in virtual funds.                    │
│                                               │
│  ✓ All features available                     │
│  ✓ Real-time price data                       │
│  ✓ No wallet connection needed                │
│  ✗ Real trades not executed                   │
│                                               │
│  [Switch to Live Mode]  [Keep Demo]           │
└──────────────────────────────────────────────┘
```

---

## 10. Next steps

Once you're comfortable with the demo:

1. **Install Freighter** — [freighter.app](https://freighter.app)
2. **Fund your wallet** — Use the [Stellar Testnet Friendbot](https://friendbot.stellar.org) for testnet XLM
3. **Create a real portfolio** — Connect your funded wallet and create a portfolio with real allocations
4. **Monitor and adjust** — Check analytics regularly and fine-tune your thresholds

---

## Troubleshooting

| Problem | Solution |
| ------- | -------- |
| Wallet not connecting | Ensure Freighter is unlocked and on the correct network (Testnet/Public) |
| Demo mode not loading | Check that `DEMO_MODE=true` in your `.env` file |
| Rebalance fails | Check slippage tolerance — try increasing if market volatility is high |
| High fees | XLM fees are typically fractions of a cent; if high, check network congestion |

---

> For detailed API documentation, see [API.md](../API.md).  
> For smart contract documentation, see [CONTRACT_EVENTS.md](./CONTRACT_EVENTS.md).  
> For deployment instructions, see the [deployment/](../../deployment/) directory.
