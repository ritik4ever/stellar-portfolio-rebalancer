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
        if config.window_seconds < 60 {
            return Err(Error::InvalidThreshold);
        }
        
        let records = (config.window_seconds / 60) as u32;
        
        // An empty price history (records == 0) would otherwise lead to a
        // divide-by-zero when averaging TWAP samples. Guard explicitly so we
        // fail safely instead of panicking/returning an invalid ratio.
        if records == 0 {
            return Err(Error::InvalidThreshold);
        }
        
        if let Some(historical_price) = client.twap(&crate::reflector::Asset::Stellar(asset.clone()), &records) {
            if historical_price > 0 {
                let diff = current_price - historical_price;
                let diff_abs = if diff < 0 { -diff } else { diff };
                let deviation_bps = (diff_abs * 10000) / historical_price;
                
                if deviation_bps > config.spike_threshold_bps as i128 {
                    // Engage the same EmergencyStop guard `set_emergency_stop`
                    // uses, not just the reason — otherwise the trip is
                    // recorded but deposits/withdrawals/rebalances (which all
                    // gate on `DataKey::EmergencyStop`) stay unblocked.
                    env.storage().instance().set(&DataKey::EmergencyStop, &true);
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
