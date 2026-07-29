use soroban_sdk::{Address, Env, Map, Symbol};
use crate::reflector::ReflectorClient;
use crate::types::{CircuitBreakerConfig, DataKey, Error, PauseReason};

pub fn check_volatility(
    env: &Env,
    config: &CircuitBreakerConfig,
    client: &ReflectorClient,
    current_prices: &Map<Address, i128>,
) -> Result<(), Error> {
    for (asset, current_price) in current_prices.iter() {
        let records = (config.window_seconds / 60).max(1) as u32;
        
        if let Some(historical_price) = client.twap(&crate::reflector::Asset::Stellar(asset.clone()), &records) {
            if historical_price > 0 {
                let diff = current_price - historical_price;
                let diff_abs = if diff < 0 { -diff } else { diff };
                let deviation_bps = (diff_abs * 10000) / historical_price;
                
                if deviation_bps > config.spike_threshold_bps as i128 {
                    env.storage()
                        .instance()
                        .set(&DataKey::ContractPauseReason, &PauseReason::VolatilityCircuitBreaker);
                    
                    env.events().publish(
                        (Symbol::new(env, "circuit_breaker_tripped"), asset.clone()),
                        (deviation_bps, PauseReason::VolatilityCircuitBreaker, env.ledger().timestamp() + config.window_seconds)
                    );
                    return Err(Error::EmergencyStop);
                }
            }
        }
    }
    Ok(())
}
