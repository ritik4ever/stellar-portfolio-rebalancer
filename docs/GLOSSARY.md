# Stellar, Reflector, and Soroban Glossary for New Contributors

This glossary defines core terms, protocols, and tools used throughout the Stellar Portfolio Rebalancer project. It's intended for new contributors who are unfamiliar with the Stellar ecosystem or Soroban smart contracts.

---

## A

### Asset
Any digital token issued on the Stellar network. Common examples: **XLM** (native), **USDC** (Stellar-based), and custom issued assets identified by `issuer:code`.

### Atomic Swap
A trustless peer-to-peer trade between two parties where both sides execute simultaneously via Stellar's `PathPayment` operations.

---

## B

### Base Reserve
The minimum XLM balance required to hold an account on Stellar. Currently 0.5 XLM. Each additional entry (trustline, offer) requires an extra 0.5 XLM base reserve.

### Balance ID
A unique identifier for a Stellar liquidity pool share balance, used in Soroban rebalance operations.

---

## C

### Classic Balance
A balance held as a standard Stellar account entry (trustline), as opposed to a Soroban contract-managed token balance.

### Claimable Balance
A Stellar mechanism that lets an account send assets to another account even if the recipient hasn't yet established a trustline. The recipient must claim the balance within a time bound.

### Contract
A Soroban smart contract deployed on the Stellar network. In this project, contracts manage rebalancing, risk parameters, and vault logic.

### Contract Instance
A deployed Soroban contract with its own persistent storage. Each instance has an associated **contract ID** and **WASM hash**.

---

## D

### DEX (Decentralized Exchange)
Stellar's built-in order-book DEX. Users can place passive offers (limit orders) and execute against the order book without intermediaries.

---

## E

### Env (Environment)
The Soroban environment that provides host functions (I/O, storage, cryptography) to running contracts. Accessed via `Env` in Rust contract code.

### Event
A Soroban contract-emitted event recorded on the Stellar ledger. Events are used to track rebalance execution, threshold breaches, and vault operations.

---

## F

### Friendbot
A Stellar testnet utility that funds new accounts with test XLM. Accessible at `https://friendbot.stellar.org`.

---

## G

### Guard
A rebalancing safety check mechanism that prevents trades under unfavorable conditions (slippage beyond tolerance, insufficient liquidity, circuit breaker state).

---

## I

### Idempotency Key
A client-supplied unique key that ensures safe retries of POST requests without duplicate side effects. Supported for portfolio creation, rebalance execution, and notification subscription endpoints.

### Invoke Host Function
A Soroban host function callable from within a contract. Examples: `env.storage().get()`, `env.prng()`, `env.current_contract()`.

---

## J

### JWT (JSON Web Token)
Used in the backend for authenticated API access. Obtained via `POST /api/auth/login` with a Stellar address and signature. Required for all portfolio management routes.

---

## L

### Ledger
A single "block" in the Stellar network. Each ledger contains a set of transactions applied to the network state. Ledgers close approximately every 5 seconds.

### Liquidity Pool (LP)
A Stellar automated market maker (AMM) pool. Users can deposit assets into a pool and earn fees, or swap through pools. Pools have shares identified by a **Balance ID**.

### Lumen (XLM)
The native asset of the Stellar network. Used for transaction fees, account reserves, and as a bridge asset in path payments.

---

## M

### Merge
A Stellar operation that closes an account and transfers its remaining XLM balance to a destination account.

### Min
The minimum amount out parameter in a swap, defining the smallest output accepted (slippage protection).

---

## O

### Offer
A passive Stellar DEX order. Offers are placed on the order book and execute when a counterparty takes the other side.

### Operation
A single action within a Stellar transaction. Supported operations: `Payment`, `CreatePassiveSellOffer`, `PathPaymentStrictReceive`, `PathPaymentStrictSend`, `ManageBuyOffer`, `ManageSellOffer`, `SetTrustLine`, etc.

---

## P

### Path Payment
A Stellar payment that can route through intermediary assets (including the AMM) to deliver the desired asset to the recipient. Used for best-execution swaps.

### Pending Balance
Funds deposited into a contract that haven't yet been allocated to a specific portfolio allocation. Held in the vault contract pending the next rebalance.

### Portfolio Rebalancer
The core application — a Stellar-based platform that automatically adjusts portfolio allocations to maintain target weights within defined tolerance thresholds.

---

## Q

### Queue (BullMQ)
Background job processing for async tasks (rebalance execution, notification dispatch, contract event indexing). Backed by Redis.

---

## R

### Rebalance
The process of adjusting a portfolio's asset allocation to restore target weights. Can be triggered manually or via the auto-rebalancer.

### Reflector
A planned Stellar-based protocol for automated portfolio management and yield optimization. The Reflector ecosystem includes the Portfolio Rebalancer as a core component.

### Reserve
See **Base Reserve**.

### Risk Check
A validation step before executing a rebalance that verifies slippage tolerance, liquidity depth, and circuit breaker status.

---

## S

### Slippage
The difference between the expected price of a swap and the executed price. Controlled by `slippageTolerance` in portfolio config.

### Soroban
Stellar's smart contract platform. Contracts are written in Rust and compiled to WASM. Soroban provides a deterministic, metered execution environment.

### Soroban CLI
The command-line tool for interacting with Soroban: deploying contracts, invoking functions, managing keys, and querying ledger state.

### Soroban Token Interface
The standard token interface (Stellar Asset Contract — SAC) for Soroban that wraps classic Stellar assets into contract-accessible token form.

### Stellar
An open-source, decentralized payment network that enables fast, low-cost cross-border transactions and asset issuance.

### Stellar Asset Contract (SAC)
A Soroban contract that wraps a classic Stellar asset (e.g., USDC:G...) into a token compatible with Soroban's token interface.

### Stellar Expert
A block explorer for the Stellar network. URL: `https://stellar.expert/explorer/`.

### Stellar Laboratory
An interactive web tool for building, signing, and submitting Stellar transactions: `https://laboratory.stellar.org/`.

### Strategy
A set of rules defining how a portfolio's rebalancing is executed: target allocations, threshold percentages, rebalance frequency, and safety parameters.

---

## T

### Threshold
The percentage deviation from target allocation that triggers a rebalance. For example, a 5% threshold means if an asset drifts ±5% from its target, a rebalance is triggered.

### Transaction
A signed set of one or more Stellar operations. Submissions cost a fee (currently 100 stroops base) and are applied atomically.

### Trustline
An account-level entry that establishes the ability to hold a specific non-XLM asset. Required before receiving any issued asset.

---

## U

### User Address
A Stellar public key (G... format) identifying a user on the network. Used as the primary user identifier across the API.

---

## V

### Vault
A Soroban contract that holds deposited funds for a portfolio, manages allocations, and enforces rebalancing rules.

---

## W

### Wallet
A Stellar wallet application used to sign transactions. Supported wallets: **Freighter** (browser extension), **xBull**, **Albedo**, and **Lobstr**.

### WASM (WebAssembly)
The compiled output of Soroban Rust contracts. Deployed to the Stellar network as contract code. Size optimization reduces deployment cost.

---

## X

### XLM
The native token of the Stellar network. Ticker: **XLM**. Used for fees, reserves, and as a bridge asset.

---

## Y

### Yield
The return generated from a portfolio's asset allocation, strategy execution, and liquidity provisioning.

---

## Z

### Zod
A TypeScript-first schema declaration and validation library used in the backend for request/response validation. Integrated with OpenAPI via `zod-openapi`.

---

## Quick Reference Table

| Term           | Category        | Where Used               |
| -------------- | --------------- | ------------------------ |
| Base Reserve   | Network         | Account setup            |
| Contract       | Soroban         | `contracts/` folder      |
| Ledger         | Network         | Everywhere               |
| Path Payment   | DEX             | Rebalance execution      |
| Risk Check     | Application     | Backend API              |
| Soroban CLI    | Tooling         | `scripts/`               |
| Stellar Expert | Explorer        | Debugging transactions   |
| Vault          | Contract        | Fund management          |
| WASM           | Contract        | Build artifacts          |
| XLM            | Asset           | Native token             |

---

## See Also

- [Soroban Development Cookbook](./soroban-cookbook.md) — Practical CLI commands
- [API Reference](../API.md) — REST API documentation
- [Frontend State Flow](./FRONTEND_STATE_FLOW.md) — React app architecture
- [Rebalancing Strategies](./REBALANCING_STRATEGIES.md) — Strategy documentation
