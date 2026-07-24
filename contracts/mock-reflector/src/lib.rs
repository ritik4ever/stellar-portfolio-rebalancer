#![no_std]

/// Minimal Reflector oracle mock for Stellar testnet integration tests.
/// Returns a fixed price of 100_00000000000000 (100.00 USD in 14-decimal format)
/// with the current ledger timestamp so prices never appear stale.
use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};

use portfolio_rebalancer::{Asset, PriceData};

#[contract]
pub struct MockReflector;

#[contractimpl]
impl MockReflector {
    /// Base currency is USD.
    pub fn base(env: Env) -> Asset {
        Asset::Other(Symbol::new(&env, "USD"))
    }

    /// Returns empty asset list (prices are served dynamically per request).
    pub fn assets(env: Env) -> Vec<Asset> {
        Vec::new(&env)
    }

    /// Price decimals: 14 (matches REFLECTOR_PRICE_DECIMALS).
    pub fn decimals(_env: Env) -> u32 {
        14
    }

    /// Returns a fixed price of 100.00 USD with the current ledger timestamp.
    pub fn lastprice(env: Env, _asset: Asset) -> Option<PriceData> {
        Some(PriceData {
            price: 100_00000000000000i128,
            timestamp: env.ledger().timestamp(),
        })
    }

    /// Returns fixed TWAP of 100.00 USD.
    pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
        Some(100_00000000000000i128)
    }
}
