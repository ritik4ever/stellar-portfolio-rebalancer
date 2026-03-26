use soroban_sdk::{contractclient, contracttype, Address, Env, Symbol, Vec};

#[contractclient(name = "ReflectorClient")]
pub trait ReflectorContract {
    fn base(env: Env) -> Asset;
    fn assets(env: Env) -> Vec<Asset>;
    fn decimals(env: Env) -> u32;
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn twap(env: Env, asset: Asset, records: u32) -> Option<i128>;
}

#[contracttype]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

impl PriceData {
    /// Convert price to human-readable format considering decimals
    pub fn to_decimal_price(&self, decimals: u32) -> i128 {
        // Use integer arithmetic instead of float
        let divisor = 10_i128.pow(decimals);
        self.price / divisor
    }

    /// Check if price data is stale (older than specified seconds)
    pub fn is_stale(&self, current_timestamp: u64, max_age_seconds: u64) -> bool {
        current_timestamp.saturating_sub(self.timestamp) > max_age_seconds
    }
}

impl Asset {
    pub fn xlm(env: &Env) -> Self {
        Asset::Other(Symbol::new(env, "XLM"))
    }

    pub fn usdc(env: &Env) -> Self {
        Asset::Other(Symbol::new(env, "USDC"))
    }

    pub fn btc(env: &Env) -> Self {
        Asset::Other(Symbol::new(env, "BTC"))
    }
}
