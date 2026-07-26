use crate::types::*;
use soroban_sdk::{token, Address, Env};

pub fn register_lp_token(
    env: &Env,
    lp_token: Address,
    asset_a: Address,
    asset_b: Address,
) -> Result<(), Error> {
    if lp_token == asset_a || lp_token == asset_b || asset_a == asset_b {
        return Err(Error::InvalidLpTokenConfig);
    }

    let config = LpTokenConfig {
        lp_token: lp_token.clone(),
        asset_a,
        asset_b,
    };

    env.storage()
        .persistent()
        .set(&DataKey::LpToken(lp_token), &config);

    Ok(())
}

pub fn get_lp_token_config(env: &Env, lp_token: &Address) -> Option<LpTokenConfig> {
    env.storage()
        .persistent()
        .get(&DataKey::LpToken(lp_token.clone()))
}

pub fn is_lp_token(env: &Env, asset: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::LpToken(asset.clone()))
}

pub fn get_sac_balance(env: &Env, token: &Address, owner: &Address) -> i128 {
    let client = token::Client::new(env, token);
    client.balance(owner)
}

pub fn get_asset_price_data(
    env: &Env,
    asset: &Address,
    reflector_client: &crate::reflector::ReflectorClient,
) -> Option<crate::reflector::PriceData> {
    if is_lp_token(env, asset) {
        get_lp_token_price_data(env, asset, reflector_client)
    } else {
        reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
    }
}

pub fn get_lp_token_price_data(
    env: &Env,
    lp_token: &Address,
    reflector_client: &crate::reflector::ReflectorClient,
) -> Option<crate::reflector::PriceData> {
    let config = get_lp_token_config(env, lp_token)?;

    let lp_client = token::Client::new(env, lp_token);
    let total_supply = lp_client.total_supply();
    if total_supply <= 0 {
        return None;
    }

    let price_a_data = reflector_client.lastprice(&crate::reflector::Asset::Stellar(config.asset_a.clone()))?;
    let price_b_data = reflector_client.lastprice(&crate::reflector::Asset::Stellar(config.asset_b.clone()))?;

    let reserve_a = get_sac_balance(env, &config.asset_a, lp_token);
    let reserve_b = get_sac_balance(env, &config.asset_b, lp_token);

    let val_a = crate::portfolio::balance_to_value(reserve_a, price_a_data.price);
    let val_b = crate::portfolio::balance_to_value(reserve_b, price_b_data.price);
    let total_pool_usd = val_a + val_b;

    let lp_price = (total_pool_usd * 10i128.pow(REFLECTOR_PRICE_DECIMALS)) / total_supply;

    let timestamp = price_a_data.timestamp.min(price_b_data.timestamp);

    Some(crate::reflector::PriceData {
        price: lp_price,
        timestamp,
    })
}
