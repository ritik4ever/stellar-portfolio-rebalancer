# Stellar, Reflector, and Soroban Glossary

## Stellar Network
| Term | Definition |
|------|------------|
| **Stellar** | Decentralized payment network connecting financial systems |
| **Lumen (XLM)** | Native asset of the Stellar network |
| **Stellar Account** | Public-private key pair identified by a G... address |
| **Trustline** | Account-level authorization to hold a specific asset |
| **Transaction** | A signed operation submitted to the Stellar network |
| **Operation** | Individual action within a transaction (payment, create account, etc.) |
| **Sequence Number** | Monotonically increasing counter that prevents replay attacks |
| **Fee** | Minimum base fee deducted from the source account |

## Soroban (Smart Contracts)
| Term | Definition |
|------|------------|
| **Soroban** | Stellar's smart contract platform |
| **Contract** | Deployed WASM binary on Soroban |
| **Contract ID** | Unique identifier for a deployed contract |
| **Host Function** | Built-in Soroban environment function |
| **Storage** | Persistent key-value store per contract |
| **Ledger Entry** | Single unit of ledger state |
| **WASM** | WebAssembly — compiled contract binary format |
| **Invoke Host Function** | Entry point for contract execution |

## Rebalancer
| Term | Definition |
|------|------------|
| **Portfolio** | Collection of assets managed by the rebalancer |
| **Allocation** | Target percentage distribution across assets |
| **Rebalance** | Trade to restore portfolio to target allocation |
| **Drift** | Deviation from target allocation percentage |
| **Threshold** | Maximum allowed drift before triggering rebalance |
| **Gas** | Fee paid for Soroban contract execution |
