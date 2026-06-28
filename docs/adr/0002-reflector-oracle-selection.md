# ADR 0002: Reflector Oracle Selection

## Status

Accepted

## Context

The Stellar Portfolio Rebalancer requires reliable, real-time price feeds for assets (such as XLM, BTC, ETH, and USDC) to calculate portfolio values, check thresholds, and execute rebalancing operations. We need to select a primary oracle solution and design a fallback mechanism to handle oracle downtime or data staleness.

We evaluated four main alternatives:
1. **Reflector**: A native Soroban-based oracle.
2. **Pyth Network**: A cross-chain oracle network (not natively deployed or optimized for Soroban on Stellar at the time of development).
3. **Band Protocol**: A cross-chain oracle network.
4. **CoinGecko API**: A centralized web API.

### Decision Criteria
- **Decentralization**: Trustlessness and on-chain verification of price feeds.
- **Latency**: Speed and frequency of price updates.
- **Cost**: Fees associated with retrieving price data (gas costs on-chain, API subscription costs off-chain).
- **Soroban Integration Ease**: Native compatibility with Stellar's Soroban smart contracts.

---

## Decision

We chose **Reflector** as our primary oracle provider. 

### Comparison Matrix

| Criteria | Reflector (Chosen) | Pyth Network | Band Protocol | CoinGecko API |
| :--- | :--- | :--- | :--- | :--- |
| **Decentralization** | **Medium-High** (Stellar native nodes) | **High** (Cross-chain) | **High** (Cross-chain) | **None** (Centralized) |
| **Latency** | **Low** (Updates every few blocks) | **Medium-Low** | **Medium** | **High** (REST API caching) |
| **Cost** | **Low** (On-chain gas only) | **Medium** (Cross-chain relay fees) | **Medium** (Relay fees) | **Free / Paid** (API keys) |
| **Soroban Ease** | **Excellent** (Native Rust SDK) | **Poor** (Requires custom bridges) | **Poor** (Requires custom bridges) | **N/A** (Off-chain only) |

### Key Rationale
- **Soroban Native**: Reflector is specifically built for Soroban, providing a native Rust client and clean contract interface (`lastprice`, `twap`).
- **Low Latency & High Frequency**: It updates frequently on Stellar's ledger, ensuring price accuracy.
- **Low On-Chain Cost**: As a native protocol, querying its smart contracts is highly gas-efficient.
- **Decentralization**: Relies on a decentralized set of nodes submitting prices to Stellar.

---

## Consequences

- **Positive:** Smooth, gas-efficient on-chain rebalancing using Soroban-native price queries.
- **Positive:** Out-of-the-box support for major Stellar assets.
- **Negative:** Hard dependency on Reflector's availability on-chain. If the Reflector contract is paused or fails to update, the smart contract cannot fetch prices directly.
- **Neutral:** Requires off-chain fallback mechanisms to maintain backend operations (analytics, preview generation) during Reflector outages.

---

## Fallback Strategy

To mitigate the risk of Reflector downtime or price staleness, a multi-tiered fallback strategy is implemented across both the smart contracts and the backend service:

### 1. On-Chain Fallback (Smart Contract)
In the smart contracts:
- We enforce a maximum price age of 1 hour (`REFLECTOR_PRICE_MAX_AGE_SECONDS = 3600` in [reflector.rs](file:///c:/Users/hp/stellar-portfolio-rebalancer/contracts/src/reflector.rs#L4)).
- If a price is missing or stale, the portfolio contract skips the affected assets during preview generation to prevent rebalancing on bad data (see `build_rebalance_preview` in [portfolio.rs](file:///c:/Users/hp/stellar-portfolio-rebalancer/contracts/src/portfolio.rs#L123-L135)).

### 2. Off-Chain Fallback (Backend Service)
The backend `ReflectorService` (in [reflector.ts](file:///c:/Users/hp/stellar-portfolio-rebalancer/backend/src/services/reflector.ts#L20-L247)) implements a four-tiered resolution pipeline:
1. **Primary Feed**: Query the Reflector API (`getReflectorPrices`).
2. **Secondary Feed (CoinGecko)**: If the Reflector API is unavailable or returns stale prices, the service falls back to the CoinGecko API (Pro or Free tier) via `getFreshPrices`.
3. **Tertiary Feed (Cache)**: If both external APIs are down, the service falls back to cached prices (stored in Redis or local memory) via `getCachedPrices`.
4. **Quaternary Feed (Synthetic/Mock)**: If no cached data is available, and `ALLOW_FALLBACK_PRICES` is enabled in the feature flags, the service returns synthetic prices via `getFallbackPrices`.
