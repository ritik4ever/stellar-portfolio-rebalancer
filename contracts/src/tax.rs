use crate::types::{DataKey, Error, LossHarvestCandidate, Portfolio};
use crate::reflector::{Asset, ReflectorClient};
use soroban_sdk::{Address, Env, Map, Vec};

pub fn get_loss_harvest_candidates(
    env: &Env,
    portfolio_id: u64,
    threshold_pct: u32,
) -> Result<Vec<LossHarvestCandidate>, Error> {
    // Load portfolio
    let portfolio: Portfolio = env
        .storage()
        .persistent()
        .get(&DataKey::Portfolio(portfolio_id))
        .ok_or(Error::PortfolioNotFound)?;

    // Get reflector client
    let reflector_address: Address = env
        .storage()
        .instance()
        .get(&DataKey::ReflectorAddress)
        .ok_or(Error::StaleData)?;
    let reflector_client = ReflectorClient::new(env, &reflector_address);

    // Load stored cost basis
    let cost_basis_map: Map<Address, i128> = env
        .storage()
        .persistent()
        .get(&DataKey::CostBasis(portfolio_id))
        .unwrap_or_else(|| Map::new(env));

    let mut candidates = Vec::new(env);

    for (asset, _) in portfolio.target_allocations.iter() {
        let cost_basis = cost_basis_map.get(asset.clone()).unwrap_or(0);
        if cost_basis <= 0 {
            continue;
        }

        // Get current price from reflector oracle
        let price_data = match reflector_client.lastprice(&Asset::Stellar(asset.clone())) {
            Some(p) => p,
            None => continue, // skip assets if price is missing
        };
        let current_price = price_data.price;

        if current_price < cost_basis {
            let loss_bps = ((cost_basis - current_price) * 10000) / cost_basis;
            let threshold_bps = (threshold_pct * 100) as i128;
            if loss_bps > threshold_bps {
                candidates.push_back(LossHarvestCandidate {
                    asset: asset.clone(),
                    cost_basis,
                    current_price,
                    loss_pct: loss_bps as u32,
                });
            }
        }
    }

    // Rank candidates by unrealized loss % (loss_pct) descending using Bubble Sort
    let n = candidates.len();
    if n > 1 {
        for i in 0..n {
            for j in 0..n - 1 - i {
                let c1 = candidates.get(j).unwrap();
                let c2 = candidates.get(j + 1).unwrap();
                if c1.loss_pct < c2.loss_pct {
                    candidates.set(j, c2);
                    candidates.set(j + 1, c1);
                }
            }
        }
    }

    Ok(candidates)
}
