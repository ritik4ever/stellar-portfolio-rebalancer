# Stellar Portfolio Rebalancer - Public Roadmap

*Last verified: 2026-09-29 against commit [`717ea95`](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/717ea95).*

## ✅ Shipped

These features were previously listed as planned or in progress and are now implemented:

| Feature | Description | Where it lives |
|---------|-------------|----------------|
| Core rebalancing algorithm | Threshold-triggered rebalancing with drift and cooldown checks | `contracts/src/portfolio.rs`, `backend/src/services/rebalancing.ts` |
| Reflector oracle integration | Real-time price feeds with caching and API fallbacks | `backend/src/services/reflector.ts`, `contracts/src/oracle.rs` |
| Wallet connection support | Freighter / Rabet / xBull connection and signing | `frontend/src/utils/walletManager.ts`, `frontend/src/utils/walletAdapters.ts` |
| Portfolio dashboard | Visual allocation and performance charts | `frontend/src/pages/Analytics.tsx`, `frontend/src/components/Dashboard.tsx` |
| Historical reports | Rebalance history, allocation history, and export | `frontend/src/components/RebalanceHistory.tsx`, `backend/src/services/portfolioExportService.ts` |
| Notification system | Email and webhook alerts with per-user preferences | `backend/src/services/notificationService.ts`, `docs/NOTIFICATIONS.md` |
| Multi-asset support | Up to 10 assets per portfolio, backed by an asset registry | `backend/src/api/validation.ts`, `backend/src/services/assetRegistryService.ts` |
| Stellar DEX integration | Slippage-aware trade execution via `@stellar/stellar-sdk` | `backend/src/services/dex.ts` |
| Rebalancing strategies | Threshold and DCA strategy support | `backend/src/services/rebalancingStrategyService.ts`, `contracts/src/strategies/` |

## 🔜 Next (1-2 months)

| Feature | Description | Status |
|---------|-------------|--------|
| Soroban contract v2 | Multi-hop swaps and limit orders | Not yet implemented |

## 📅 Later (3-6+ months)

| Feature | Description |
|---------|-------------|
| Mobile Application | iOS/Android app for portfolio monitoring |
| Team portfolios | Multi-user collaboration with role-based access |
| Governance | DAO voting for protocol parameters |
| Cross-chain | Bridge support for non-Stellar assets |
| Lending integration | Connect with Stellar lending protocols |
| Tax optimization | Minimize tax impact during rebalancing |

##  How to Contribute

1. Check issues labeled `good-first-issue` or `help-wanted`
2. Comment on the issue you want to work on
3. Follow the [CONTRIBUTING.md](CONTRIBUTING.md) guide

## Roadmap Updates

This document is re-verified against the codebase at each release and reviewed monthly. When a change completes or invalidates an item above, update it and refresh the **Last verified** line at the top.
