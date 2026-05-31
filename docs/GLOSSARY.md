# Stellar & Soroban Glossary

## Core Stellar Concepts

| Term | Definition |
|------|------------|
| **Stellar** | A decentralized blockchain network optimized for cross-border payments and asset issuance. |
| **Lumen (XLM)** | The native asset of the Stellar network, used for transaction fees and as a bridge currency. |
| **Stellar Account** | A public key / secret key pair identified by a `G...` address. |
| **Friendbot** | A Stellar testnet service that funds new accounts with test XLM. |
| **Trustline** | An account's declaration of trust in a specific asset issuer, required to hold non-XLM tokens. |
| **Transaction** | A signed operation submitted to the Stellar network. |
| **Sequence Number** | A monotonic counter that prevents transaction replay. |

## Soroban Smart Contracts

| Term | Definition |
|------|------------|
| **Soroban** | Stellar's smart contract platform supporting Rust/WASM contracts. |
| **Contract ID** | A `C...` address identifying a deployed Soroban contract. |
| **WASM** | WebAssembly binary format used to compile Soroban contracts. |
| **stellar-cli** | Command-line tool for building, deploying, and interacting with Soroban contracts. |
| **Invoke** | Calling a contract function via a Soroban transaction. |

## Rebalancer-Specific Terms

| Term | Definition |
|------|------------|
| **Reflector** | The price oracle service that provides asset price feeds for rebalancing decisions. |
| **Rebalance Strategy** | A set of rules that determines when and how to adjust portfolio allocations. |
| **Portfolio** | A collection of asset holdings tracked by the rebalancer. |
| **Target Allocation** | The desired percentage distribution of assets in a portfolio. |
| **Drift** | The deviation of current allocation from the target allocation. |
