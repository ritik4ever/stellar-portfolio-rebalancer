use crate::reflector::{Asset, PriceData, ReflectorClient};
use crate::types::DataKey;
use soroban_sdk::{contractclient, contracttype, Address, Env, Symbol};

pub const DEFAULT_DEVIATION_THRESHOLD_BPS: u32 = 300;

#[contractclient(name = "CoinGeckoClient")]
pub trait CoinGeckoContract {
    fn price(env: Env, asset: Address) -> Option<i128>;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleConfig {
    pub deviation_threshold_bps: u32,
    pub fallback_behavior: u32,
}

impl OracleConfig {
    pub fn default() -> Self {
        OracleConfig {
            deviation_threshold_bps: DEFAULT_DEVIATION_THRESHOLD_BPS,
            fallback_behavior: 0,
        }
    }
}

pub fn emit_oracle_deviation_warning(
    env: &Env,
    asset: &Address,
    reflector_price: i128,
    fallback_price: i128,
    deviation_bps: u32,
) {
    env.events().publish(
        (Symbol::new(env, "oracle_dev_warn"), asset.clone()),
        (reflector_price, fallback_price, deviation_bps),
    );
}

pub fn get_validated_price(
    env: &Env,
    asset: &Address,
    reflector_client: &ReflectorClient,
) -> Option<PriceData> {
    let price_data = reflector_client.lastprice(&Asset::Stellar(asset.clone()))?;

    let coingecko_address: Option<Address> =
        env.storage().instance().get(&DataKey::CoinGeckoAddress);
    let oracle_config: OracleConfig = env
        .storage()
        .instance()
        .get(&DataKey::OracleConfig)
        .unwrap_or(OracleConfig::default());

    let Some(cg_addr) = coingecko_address else {
        return Some(price_data);
    };

    let cg_client = CoinGeckoClient::new(env, &cg_addr);
    let cg_price = match cg_client.try_price(&asset) {
        Ok(Ok(Some(p))) => p,
        _ => return Some(price_data),
    };

    let reflector_price = price_data.price;
    let max_price = if reflector_price >= cg_price {
        reflector_price
    } else {
        cg_price
    };
    let min_price = if reflector_price <= cg_price {
        reflector_price
    } else {
        cg_price
    };

    if max_price == 0 {
        return Some(price_data);
    }

    let diff = max_price - min_price;
    let deviation_bps = ((diff * 10000) / max_price) as u32;

    if deviation_bps <= oracle_config.deviation_threshold_bps {
        return Some(price_data);
    }

    emit_oracle_deviation_warning(env, asset, reflector_price, cg_price, deviation_bps);

    if oracle_config.fallback_behavior == 0 {
        let conservative_price = min_price;
        Some(PriceData {
            price: conservative_price,
            timestamp: price_data.timestamp,
        })
    } else if oracle_config.fallback_behavior == 1 {
        Some(price_data)
    } else {
        None
    }
}
