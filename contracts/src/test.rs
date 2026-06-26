
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    vec, Address, Env, IntoVal, Map, String,
};

fn allocation_decimals(env: &Env, allocations: &Map<Address, u32>, decimals: u32) -> Map<Address, u32> {
    let mut asset_decimals = Map::new(env);
    for (asset, _) in allocations.iter() {
        asset_decimals.set(asset, decimals);
    }
    asset_decimals
}

fn create_portfolio_with_defaults(
    env: &Env,
    client: &PortfolioRebalancerClient,
    user: &Address,
    allocations: &Map<Address, u32>,
    rebalance_threshold: u32,
    slippage_tolerance: u32,
) -> u64 {
    let asset_decimals = allocation_decimals(env, allocations, DEFAULT_ASSET_DECIMALS);
    client.create_portfolio(
        user,
        allocations,
        &asset_decimals,
        &rebalance_threshold,
        &slippage_tolerance,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    )
}

const BENCHMARK_TOLERANCE_PERCENT: u64 = 20;
const BASELINE_INITIALIZE_CPU: u64 = 1_500_000;
const BASELINE_INITIALIZE_MEM: u64 = 200_000;
const BASELINE_CREATE_PORTFOLIO_CPU: u64 = 2_500_000;
const BASELINE_CREATE_PORTFOLIO_MEM: u64 = 300_000;
const BASELINE_EXECUTE_REBALANCE_CPU: u64 = 5_000_000;
const BASELINE_EXECUTE_REBALANCE_MEM: u64 = 500_000;
const BASELINE_DEPOSIT_CPU: u64 = 2_000_000;
const BASELINE_DEPOSIT_MEM: u64 = 250_000;

// Mock Reflector Contract
mod reflector_contract {
    use crate::reflector::{Asset, PriceData};
    use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};

    #[contract]
    pub struct MockReflector;

    #[contractimpl]
    impl MockReflector {
        pub fn base(_env: Env) -> Asset {
            Asset::Other(Symbol::new(&_env, "USD"))
        }
        pub fn assets(_env: Env) -> Vec<Asset> {
            Vec::new(&_env)
        }
        pub fn decimals(_env: Env) -> u32 {
            14
        }
        pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
            let price = match asset {
                Asset::Stellar(_addr) => {
                    100_00000000000000i128
                }
                _ => 100_00000000000000i128,
            };

            Some(PriceData {
                price,
                timestamp: env.ledger().timestamp(),
            })
        }
        pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
            Some(100_00000000000000i128)
        }
    }
}

mod reflector_with_missing_price {
    use crate::reflector::{Asset, PriceData};
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};

    #[contract]
    pub struct ReflectorWithMissingPrice;

    #[contracttype]
    pub enum DataKey {
        MissingAsset,
    }

    #[contractimpl]
    impl ReflectorWithMissingPrice {
        pub fn base(env: Env) -> Asset {
            Asset::Other(Symbol::new(&env, "USD"))
        }

        pub fn assets(env: Env) -> Vec<Asset> {
            Vec::new(&env)
        }

        pub fn decimals(_env: Env) -> u32 {
            14
        }

        pub fn set_missing_asset(env: Env, asset: Address) {
            env.storage().instance().set(&DataKey::MissingAsset, &asset);
        }

        pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
            let missing_asset = env
                .storage()
                .instance()
                .get::<DataKey, Address>(&DataKey::MissingAsset);
            match asset {
                Asset::Stellar(address) => {
                    if missing_asset == Some(address.clone()) {
                        None
                    } else {
                        Some(PriceData {
                            price: 100_00000000000000i128,
                            timestamp: env.ledger().timestamp(),
                        })
                    }
                }
                _ => None,
            }
        }

        pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
            Some(100_00000000000000i128)
        }
    }
}

mod reflector_without_prices {
    use crate::reflector::{Asset, PriceData};
    use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};

    #[contract]
    pub struct ReflectorWithoutPrices;

    #[contractimpl]
    impl ReflectorWithoutPrices {
        pub fn base(env: Env) -> Asset {
            Asset::Other(Symbol::new(&env, "USD"))
        }

        pub fn assets(env: Env) -> Vec<Asset> {
            Vec::new(&env)
        }

        pub fn decimals(_env: Env) -> u32 {
            14
        }

        pub fn lastprice(_env: Env, _asset: Asset) -> Option<PriceData> {
            None
        }

        pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
            None
        }
    }
}

#[test]
fn test_create_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.sequence_number = 1;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1, 5000);
    allocations.set(asset2, 5000);

    let portfolio_id = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    assert!(portfolio_id > 0);
}

#[test]
fn test_deposit_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset, &1000, &String::from_str(&env, ""));

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset).unwrap(), 1000);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_deposit_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let result = client.try_deposit(&pid, &asset, &0, &String::from_str(&env, ""));
    assert_eq!(result, Err(Ok(Error::InvalidWithdrawAmount)));
    client.deposit(&pid, &asset, &0, &String::from_str(&env, ""));
}

#[test]
fn test_check_rebalance_needed_no_drift() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);

    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &100, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &100, &String::from_str(&env, ""));

    assert!(!client.check_rebalance_needed(&pid));
}

#[test]
fn test_check_rebalance_needed_with_drift() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);

    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &200, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &100, &String::from_str(&env, ""));

    assert!(client.check_rebalance_needed(&pid));
}

#[test]
fn test_execute_rebalance_success() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);

    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    let actual_balances = Map::new(&env);
    client.execute_rebalance(&pid, &actual_balances);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 15000);
}

#[test]
fn test_execute_rebalance_cooldown() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.ledger().with_mut(|li| {
        li.timestamp = 10010;
    });

    let actual_balances = Map::new(&env);
    let result = client.try_execute_rebalance(&pid, &actual_balances);
    assert_eq!(result, Err(Ok(Error::CooldownActive)));
}

#[test]
fn test_emergency_stop() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.set_emergency_stop(&true);
    let result = client.try_deposit(&pid, &asset, &100, &String::from_str(&env, ""));
    assert_eq!(result, Err(Ok(Error::EmergencyStop)));
    client.set_emergency_stop(&false);

    client.deposit(&pid, &asset, &100, &String::from_str(&env, ""));
}

#[test]
fn test_stale_data() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    mod stale_reflector {
        use crate::reflector::{Asset, PriceData};
        use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};

        #[contract]
        pub struct StaleReflector;

        #[contractimpl]
        impl StaleReflector {
            pub fn base(_env: Env) -> Asset {
                Asset::Other(Symbol::new(&_env, "USD"))
            }
            pub fn assets(_env: Env) -> Vec<Asset> {
                Vec::new(&_env)
            }
            pub fn decimals(_env: Env) -> u32 {
                14
            }
            pub fn lastprice(env: Env, _asset: Asset) -> Option<PriceData> {
                let current = env.ledger().timestamp();
                Some(PriceData {
                    price: 100_00000000000000,
                    timestamp: current - 7200,
                })
            }
            pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
                Some(0)
            }
        }
    }

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let stale_reflector_id = env.register_contract(None, stale_reflector::StaleReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &stale_reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    let actual_balances = Map::new(&env);
    let _result = client.try_execute_rebalance(&pid, &actual_balances);
}

#[test]
fn test_edge_case_single_asset() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    client.initialize(&Address::generate(&env), &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);

    let owner = Address::generate(&env);
    let pid = create_portfolio_with_defaults(&env, &client, &owner, &allocations, 5, 50);
    assert!(!client.check_rebalance_needed(&pid));
}

#[test]
fn test_portfolio_validation() {
    let env = Env::default();
    let mut allocations = Map::new(&env);

    allocations.set(Address::generate(&env), 6000);
    allocations.set(Address::generate(&env), 4000);
    assert!(crate::portfolio::validate_allocations(&allocations));

    let mut invalid_allocations = Map::new(&env);
    invalid_allocations.set(Address::generate(&env), 6000);
    invalid_allocations.set(Address::generate(&env), 3000);
    assert!(!crate::portfolio::validate_allocations(
        &invalid_allocations
    ));
}

fn allocation_map_from_percentages(env: &Env, bps_values: &[u32]) -> Map<Address, u32> {
    let mut allocations = Map::new(env);
    for bps in bps_values {
        allocations.set(Address::generate(env), *bps);
    }
    allocations
}

fn random_bps_with_target_sum(seed: &mut u64, count: usize, target_sum: u32) -> [u32; 12] {
    let mut values = [0u32; 12];
    let mut remaining = target_sum;
    let limit = count.min(12);
    for (i, value) in values.iter_mut().enumerate().take(limit) {
        if i + 1 == limit {
            *value = remaining;
            break;
        }
        *seed ^= *seed << 13;
        *seed ^= *seed >> 7;
        *seed ^= *seed << 17;
        let next = if remaining == 0 {
            0
        } else {
            ((*seed as u32) % (remaining + 1)).min(remaining)
        };
        *value = next;
        remaining -= next;
    }
    values
}

#[test]
fn test_validate_allocations_randomized_sum_10000_accepts_500_vectors() {
    let env = Env::default();
    let mut seed = 0xC0FFEEu64;
    for _ in 0..500 {
        let mut adjusted = [0u32; 10];
        let mut remaining = 10000u32;
        for (i, slot) in adjusted.iter_mut().enumerate() {
            let slots_left = 10 - i;
            if slots_left == 1 {
                *slot = remaining;
                break;
            }
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let max_for_slot = remaining - (slots_left as u32 - 1);
            let next = 1 + ((seed as u32) % max_for_slot);
            *slot = next;
            remaining -= next;
        }
        let allocations = allocation_map_from_percentages(&env, &adjusted);
        assert!(crate::portfolio::validate_allocations(&allocations));
    }
}

#[test]
fn test_validate_allocations_randomized_sum_9999_rejects_500_vectors() {
    let env = Env::default();
    let mut seed = 0xBAD5EEDu64;
    for _ in 0..500 {
        let raw = random_bps_with_target_sum(&mut seed, 10, 9999);
        let allocations = allocation_map_from_percentages(&env, &raw[..10]);
        assert!(!crate::portfolio::validate_allocations(&allocations));
    }
}

#[test]
fn test_validate_allocations_randomized_sum_10001_rejects_500_vectors() {
    let env = Env::default();
    let mut seed = 0xDEADBEEFu64;
    for _ in 0..500 {
        let raw = random_bps_with_target_sum(&mut seed, 10, 10001);
        let allocations = allocation_map_from_percentages(&env, &raw[..10]);
        assert!(!crate::portfolio::validate_allocations(&allocations));
    }
}

#[test]
fn test_validate_allocations_empty_map_boundary() {
    let env = Env::default();
    let allocations = Map::new(&env);
    assert!(!crate::portfolio::validate_allocations(&allocations));
}

#[test]
fn test_validate_allocations_single_asset_full_boundary() {
    let env = Env::default();
    let allocations = allocation_map_from_percentages(&env, &[10000]);
    assert!(crate::portfolio::validate_allocations(&allocations));
}

#[test]
fn test_validate_allocations_ten_assets_equal_weight() {
    let env = Env::default();
    let allocations = allocation_map_from_percentages(&env, &[1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
    assert!(crate::portfolio::validate_allocations(&allocations));
}

#[test]
fn test_validate_allocations_fractional_three_way_split() {
    let env = Env::default();
    // 33.33% + 33.33% + 33.34% = 100.00%
    let allocations = allocation_map_from_percentages(&env, &[3333, 3333, 3334]);
    assert!(crate::portfolio::validate_allocations(&allocations));
}

#[test]
fn test_validate_allocations_overflow_rejected() {
    let env = Env::default();
    let allocations = allocation_map_from_percentages(&env, &[u32::MAX, 1]);
    assert!(!crate::portfolio::validate_allocations(&allocations));
}

fn build_trade_test_portfolio(
    env: &Env,
    allocations: &[(Address, u32)],
    balances: &[(Address, i128)],
    total_value: i128,
) -> Portfolio {
    let mut target_allocations = Map::new(env);
    for (asset, bps) in allocations {
        target_allocations.set(asset.clone(), *bps);
    }
    let mut current_balances = Map::new(env);
    for (asset, balance) in balances {
        current_balances.set(asset.clone(), *balance);
    }
    let asset_decimals = allocation_decimals(env, &target_allocations, DEFAULT_ASSET_DECIMALS);
    Portfolio {
        user: Address::generate(env),
        target_allocations,
        current_balances,
        asset_decimals,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value,
        is_active: true,
        pause_reason: PauseReason::None,
    }
}

#[test]
fn test_calculate_rebalance_trades_excludes_below_minimum_stroops() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let asset3 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 10000);
    allocations.set(asset2.clone(), 10000);
    allocations.set(asset3.clone(), 10000);

    let target_balance = 50_000_000i128;
    let mut balances = Map::new(&env);
    balances.set(
        asset1.clone(),
        target_balance - (MIN_TRADE_AMOUNT_STROOPS / 2),
    );
    balances.set(asset2.clone(), target_balance - MIN_TRADE_AMOUNT_STROOPS);
    balances.set(
        asset3.clone(),
        target_balance - (MIN_TRADE_AMOUNT_STROOPS + 1),
    );

    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        asset_decimals,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value: target_balance,
        is_active: true,
        pause_reason: PauseReason::None,
    };

    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 10i128.pow(14));
    prices.set(asset2.clone(), 10i128.pow(14));
    prices.set(asset3.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);
    assert!(!trades.contains_key(asset1));
    assert!(!trades.contains_key(asset2));
    assert_eq!(trades.get(asset3).unwrap(), MIN_TRADE_AMOUNT_STROOPS + 1);
}

#[test]
fn test_calculate_rebalance_trades_2_asset() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);

    let mut balances = Map::new(&env);
    balances.set(asset1.clone(), 150 * 10i128.pow(14));
    balances.set(asset2.clone(), 50 * 10i128.pow(14));

    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        asset_decimals,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value: 200 * 10i128.pow(14),
        is_active: true,
        pause_reason: PauseReason::None,
    };

    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 10i128.pow(14));
    prices.set(asset2.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);

    assert_eq!(trades.get(asset1.clone()).unwrap(), -50 * 10i128.pow(14));
    assert_eq!(trades.get(asset2.clone()).unwrap(), 50 * 10i128.pow(14));
}

#[test]
fn test_calculate_rebalance_trades_two_asset_direction_correctness() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let portfolio = build_trade_test_portfolio(
        &env,
        &[(asset1.clone(), 5000), (asset2.clone(), 5000)],
        &[(asset1.clone(), 70_000_000), (asset2.clone(), 30_000_000)],
        100_000_000,
    );
    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 10i128.pow(14));
    prices.set(asset2.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);

    assert_eq!(trades.get(asset1).unwrap(), -20_000_000);
    assert_eq!(trades.get(asset2).unwrap(), 20_000_000);
}

#[test]
fn test_calculate_rebalance_trades_5_asset() {
    let env = Env::default();
    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let a3 = Address::generate(&env);
    let a4 = Address::generate(&env);
    let a5 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(a1.clone(), 2000);
    allocations.set(a2.clone(), 2000);
    allocations.set(a3.clone(), 2000);
    allocations.set(a4.clone(), 2000);
    allocations.set(a5.clone(), 2000);

    let mut balances = Map::new(&env);
    balances.set(a1.clone(), 50 * 10i128.pow(14));
    balances.set(a2.clone(), 150 * 10i128.pow(14));
    balances.set(a3.clone(), 100 * 10i128.pow(14));
    balances.set(a4.clone(), 20 * 10i128.pow(14));
    balances.set(a5.clone(), 180 * 10i128.pow(14));

    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        asset_decimals,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value: 500 * 10i128.pow(14),
        is_active: true,
        pause_reason: PauseReason::None,
    };

    let mut prices = Map::new(&env);
    prices.set(a1.clone(), 10i128.pow(14));
    prices.set(a2.clone(), 10i128.pow(14));
    prices.set(a3.clone(), 10i128.pow(14));
    prices.set(a4.clone(), 10i128.pow(14));
    prices.set(a5.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);

    assert_eq!(trades.get(a1).unwrap(), 50 * 10i128.pow(14));
    assert_eq!(trades.get(a2).unwrap(), -50 * 10i128.pow(14));
    assert!(!trades.contains_key(a3));
    assert_eq!(trades.get(a4).unwrap(), 80 * 10i128.pow(14));
    assert_eq!(trades.get(a5).unwrap(), -80 * 10i128.pow(14));
}

#[test]
fn test_calculate_rebalance_trades_direction_buy_sell() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);

    let mut balances = Map::new(&env);
    balances.set(asset1.clone(), 120 * 10i128.pow(14));
    balances.set(asset2.clone(), 80 * 10i128.pow(14));

    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        asset_decimals,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value: 200 * 10i128.pow(14),
        is_active: true,
        pause_reason: PauseReason::None,
    };

    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 10i128.pow(14));
    prices.set(asset2.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);

    let trade_a1 = trades.get(asset1).unwrap();
    let trade_a2 = trades.get(asset2).unwrap();

    assert!(trade_a1 < 0, "Overweight asset should result in a sell (negative) trade");
    assert!(trade_a2 > 0, "Underweight asset should result in a buy (positive) trade");
    assert_eq!(trade_a1, -20 * 10i128.pow(14));
    assert_eq!(trade_a2, 20 * 10i128.pow(14));
}

#[test]
fn test_calculate_rebalance_trades_price_precision() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 6000);
    allocations.set(asset2.clone(), 4000);

    let mut balances = Map::new(&env);
    balances.set(asset1.clone(), 150 * 10i128.pow(14));
    balances.set(asset2.clone(), 125 * 10i128.pow(13));

    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        asset_decimals,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value: 100 * 10i128.pow(14),
        is_active: true,
        pause_reason: PauseReason::None,
    };

    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 50_000_000_000_000);
    prices.set(asset2.clone(), 200_000_000_000_000);

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);

    assert_eq!(trades.get(asset1).unwrap(), -30 * 10i128.pow(14));
    assert_eq!(trades.get(asset2).unwrap(), 75 * 10i128.pow(13));
}

#[test]
fn test_calculate_rebalance_trades_three_asset_rebalance_path() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let asset3 = Address::generate(&env);
    let portfolio = build_trade_test_portfolio(
        &env,
        &[
            (asset1.clone(), 5000),
            (asset2.clone(), 3000),
            (asset3.clone(), 2000),
        ],
        &[
            (asset1.clone(), 40_000_000),
            (asset2.clone(), 40_000_000),
            (asset3.clone(), 20_000_000),
        ],
        100_000_000,
    );
    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 10i128.pow(14));
    prices.set(asset2.clone(), 10i128.pow(14));
    prices.set(asset3.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);
    assert_eq!(trades.get(asset1).unwrap(), 10_000_000);
    assert_eq!(trades.get(asset2).unwrap(), -10_000_000);
    assert!(!trades.contains_key(asset3));
}

#[test]
fn test_calculate_rebalance_trades_exact_boundary() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let asset3 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 4000);
    allocations.set(asset2.clone(), 3000);
    allocations.set(asset3.clone(), 3000);

    let mut balances = Map::new(&env);
    let target1 = 40_000_000i128;
    let target2 = 30_000_000i128;
    let target3 = 30_000_000i128;

    balances.set(asset1.clone(), target1 - MIN_TRADE_AMOUNT_STROOPS);
    balances.set(asset2.clone(), target2 - (MIN_TRADE_AMOUNT_STROOPS - 1));
    balances.set(asset3.clone(), target3 - (MIN_TRADE_AMOUNT_STROOPS + 1));

    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        asset_decimals,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value: 100_000_000i128,
        is_active: true,
        pause_reason: PauseReason::None,
    };

    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 10i128.pow(14));
    prices.set(asset2.clone(), 10i128.pow(14));
    prices.set(asset3.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);

    assert!(!trades.contains_key(asset1));
    assert!(!trades.contains_key(asset2));
    assert_eq!(trades.get(asset3).unwrap(), MIN_TRADE_AMOUNT_STROOPS + 1);
}

#[test]
fn test_calculate_rebalance_trades_five_asset_rebalance_path() {
    let env = Env::default();
    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let a3 = Address::generate(&env);
    let a4 = Address::generate(&env);
    let a5 = Address::generate(&env);
    let portfolio = build_trade_test_portfolio(
        &env,
        &[
            (a1.clone(), 2000),
            (a2.clone(), 2000),
            (a3.clone(), 2000),
            (a4.clone(), 2000),
            (a5.clone(), 2000),
        ],
        &[
            (a1.clone(), 300_000_000),
            (a2.clone(), 50_000_000),
            (a3.clone(), 50_000_000),
            (a4.clone(), 50_000_000),
            (a5.clone(), 50_000_000),
        ],
        500_000_000,
    );
    let mut prices = Map::new(&env);
    for asset in vec![
        &env,
        a1.clone(),
        a2.clone(),
        a3.clone(),
        a4.clone(),
        a5.clone(),
    ]
    .iter()
    {
        prices.set(asset.clone(), 10i128.pow(14));
    }

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);
    assert_eq!(trades.get(a1).unwrap(), -200_000_000);
    assert_eq!(trades.get(a2).unwrap(), 50_000_000);
    assert_eq!(trades.get(a3).unwrap(), 50_000_000);
    assert_eq!(trades.get(a4).unwrap(), 50_000_000);
    assert_eq!(trades.get(a5).unwrap(), 50_000_000);
}

#[test]
fn test_calculate_rebalance_trades_price_precision_14_decimals_edge_case() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let precise_price = 123_456_789_012_345i128;
    let target_balance = 100_000_000i128;
    let portfolio = build_trade_test_portfolio(
        &env,
        &[(asset1.clone(), 5000), (asset2.clone(), 5000)],
        &[
            (asset1.clone(), target_balance - (MIN_TRADE_AMOUNT_STROOPS + 5)),
            (asset2.clone(), target_balance + (MIN_TRADE_AMOUNT_STROOPS + 5)),
        ],
        246_913_578,
    );
    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), precise_price);
    prices.set(asset2.clone(), precise_price);

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);
    let expected_target_value = (portfolio.total_value * 5000) / 10000;
    let expected_target_balance =
        crate::portfolio::value_to_balance(expected_target_value, precise_price, DEFAULT_ASSET_DECIMALS);
    let expected_buy = expected_target_balance - (target_balance - (MIN_TRADE_AMOUNT_STROOPS + 5));
    let expected_sell = expected_target_balance - (target_balance + (MIN_TRADE_AMOUNT_STROOPS + 5));
    assert_eq!(trades.get(asset1).unwrap(), expected_buy);
    assert_eq!(trades.get(asset2).unwrap(), expected_sell);
}

#[test]
#[should_panic]
fn test_initialize_guard() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reflector_id);
    client.initialize(&admin, &reflector_id);
}

#[test]
#[should_panic]
fn test_create_portfolio_invalid_allocation() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 6000);
    allocations.set(Address::generate(&env), 3000); // sums to 9000, not 10000

    create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
}

#[test]
#[should_panic]
fn test_create_portfolio_threshold_too_low() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);

    create_portfolio_with_defaults(&env, &client, &user, &allocations, 0, 50);
}

#[test]
#[should_panic]
fn test_create_portfolio_threshold_too_high() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);

    create_portfolio_with_defaults(&env, &client, &user, &allocations, 51, 50);
}

#[test]
fn test_create_portfolio_multiple_same_ledger() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.sequence_number = 1;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);

    let pid1 = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    let pid2 = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    assert_eq!(pid1, 1);
    assert_eq!(pid2, 2);
    assert_ne!(pid1, pid2);
}

#[test]
fn test_portfolio_id_starts_at_one() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| { li.sequence_number = 1; });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);

    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    assert_eq!(pid, 1);
}

#[test]
#[should_panic]
fn test_create_portfolio_slippage_too_low() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    client.initialize(&Address::generate(&env), &reflector_id);
    let user = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);

    create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 5);
}

#[test]
#[should_panic]
fn test_create_portfolio_slippage_too_high() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    client.initialize(&Address::generate(&env), &reflector_id);
    let user = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);

    create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 501);
}

#[test]
fn test_emergency_stop_admin_pause_and_reactivate() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.set_emergency_stop(&true);
    client.set_emergency_stop(&false);

    client.deposit(&pid, &asset, &100, &String::from_str(&env, ""));
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset).unwrap(), 100);
}

#[test]
fn test_get_admin_returns_configured_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let configured_admin = client.get_admin();
    assert_eq!(configured_admin, admin);
}

#[test]
#[should_panic]
fn test_emergency_stop_non_admin_rejected() {
    let env = Env::default();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&admin, &reflector_id).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .initialize(&admin, &reflector_id);

    client
        .mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_emergency_stop",
                args: vec![&env, true.into_val(&env)],
                sub_invokes: &[],
            },
        }])
        .set_emergency_stop(&true);
}

#[test]
fn test_create_portfolio_max_assets_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut max_allocations = Map::new(&env);
    for _ in 0..MAX_PORTFOLIO_ASSETS {
        max_allocations.set(Address::generate(&env), ALLOCATION_DENOMINATOR / MAX_PORTFOLIO_ASSETS);
    }
    let pid = create_portfolio_with_defaults(&env, &client, &user, &max_allocations, 5, 50);
    assert!(pid > 0);

    let mut too_many_allocations = Map::new(&env);
    for _ in 0..20u32 {
        too_many_allocations.set(Address::generate(&env), 500);
    }
    let too_many_decimals = allocation_decimals(&env, &too_many_allocations, DEFAULT_ASSET_DECIMALS);
    let result = client.try_create_portfolio(
        &user,
        &too_many_allocations,
        &too_many_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );
    assert_eq!(result, Err(Ok(Error::TooManyAssets)));
}

#[test]
fn test_portfolio_storage_footprint_estimate_is_deterministic() {
    let env = Env::default();

    let portfolio = build_trade_test_portfolio(
        &env,
        &[(Address::generate(&env), 7000), (Address::generate(&env), 3000)],
        &[],
        0,
    );

    let portfolio_id = 7;
    let estimate =
        crate::portfolio::estimate_portfolio_storage_footprint(&env, portfolio_id, &portfolio);
    let estimate_again =
        crate::portfolio::estimate_portfolio_storage_footprint(&env, portfolio_id, &portfolio);

    assert_eq!(estimate, estimate_again);
    assert!(estimate > 0);
    assert_eq!(
        crate::portfolio::validate_portfolio_storage_footprint(&env, portfolio_id, &portfolio),
        Ok(estimate)
    );
}

#[test]
fn test_transfer_stewardship() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let new_steward = Address::generate(&env);
    client.transfer_stewardship(&pid, &new_steward);

    let steward = client.get_steward(&pid);
    assert_eq!(steward, new_steward);
}

#[test]
fn test_transfer_stewardship_steward_can_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let new_steward = Address::generate(&env);
    client.transfer_stewardship(&pid, &new_steward);

    client.mock_auths(&[MockAuth {
        address: &new_steward,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "deposit",
            args: (pid, asset.clone(), 500i128, String::from_str(&env, "")).into_val(&env),
            sub_invokes: &[],
        },
    }]).deposit(&pid, &asset, &500, &String::from_str(&env, ""));

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset).unwrap(), 500);
}

#[test]
fn test_preview_rebalance_reports_trades_and_thresholds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &20_000_000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &10_000_000, &String::from_str(&env, ""));

    let preview = client.preview_rebalance(&pid);
    assert!(preview.rebalance_needed);
    assert!(preview.candidate_trades.contains_key(asset1.clone()));
    assert!(preview.threshold_decisions.contains_key(asset1.clone()));
    let decision = preview.threshold_decisions.get(asset1).unwrap();
    assert!(decision.exceeds_threshold);
}

#[test]
fn test_preview_rebalance_does_not_mutate_portfolio() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset, &1000, &String::from_str(&env, ""));

    let before = client.get_portfolio(&pid);
    let _ = client.preview_rebalance(&pid);
    let after = client.get_portfolio(&pid);
    assert_eq!(before.last_rebalance, after.last_rebalance);
    assert_eq!(
        before.current_balances.get(asset.clone()).unwrap(),
        after.current_balances.get(asset).unwrap()
    );
}

#[test]
fn test_create_portfolio_stores_slippage_policy_version() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.slippage_policy_version, SLIPPAGE_POLICY_VERSION_V1);
}

#[test]
#[should_panic]
fn test_transfer_stewardship_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let unauthorized = Address::generate(&env);
    let attacker = Address::generate(&env);
    client.mock_auths(&[MockAuth {
        address: &unauthorized,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "transfer_stewardship",
            args: (pid, attacker.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]).transfer_stewardship(&pid, &attacker);
}

#[test]
fn test_get_steward_defaults_to_user() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let steward = client.get_steward(&pid);
    assert_eq!(steward, user);
}

#[test]
fn test_capabilities() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let caps = client.capabilities();
    assert!(caps & CapabilityFlag::PerPortfolioSteward as u32 != 0);
    assert!(caps & CapabilityFlag::DifferentiatedPricing as u32 != 0);
    assert!(caps & CapabilityFlag::EmergencyStop as u32 != 0);
}

#[test]
fn test_missing_price_error() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let missing_reflector_id = env.register_contract(None, reflector_without_prices::ReflectorWithoutPrices);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &missing_reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert!(result.is_err());
}

#[test]
#[should_panic]
fn test_create_portfolio_unsupported_slippage_policy_version() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);
    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    client.create_portfolio(&user, &allocations, &asset_decimals, &5, &50, &99);
}

#[test]
#[should_panic]
fn test_create_portfolio_invalid_asset_decimals() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);

    let empty_decimals = Map::new(&env);
    client.create_portfolio(
        &user,
        &allocations,
        &empty_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );
}

#[test]
fn test_pause_portfolio_persists_reason() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.pause_portfolio(&pid, &PauseReason::UserPaused);
    let portfolio = client.get_portfolio(&pid);
    assert!(!portfolio.is_active);
    assert_eq!(portfolio.pause_reason, PauseReason::UserPaused);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_deposit_rejects_paused_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.pause_portfolio(&pid, &PauseReason::VolatilityCircuitBreaker);
    client.deposit(&pid, &asset, &100, &String::from_str(&env, ""));
}

#[test]
fn test_execute_rebalance_rejects_paused_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 15_000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.pause_portfolio(&pid, &PauseReason::UserPaused);

    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(result, Err(Ok(Error::PortfolioPaused)));
}

#[test]
fn test_contract_pause_reason_on_emergency_stop() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    client.set_emergency_stop(&true);
    assert_eq!(client.get_contract_pause_reason(), PauseReason::AdminEmergency);

    client.set_emergency_stop(&false);
    assert_eq!(client.get_contract_pause_reason(), PauseReason::None);
}

#[test]
fn test_check_invariants_inactive_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset, &100, &String::from_str(&env, ""));
    client.withdraw(&pid, &asset, &100);

    let result = client.try_check_invariants(&pid);
    assert_eq!(result, Ok(Ok(())));
}

#[test]
fn test_withdraw_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset, &1000, &String::from_str(&env, ""));
    client.withdraw(&pid, &asset, &400);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset).unwrap(), 600);
    assert!(portfolio.is_active);
}

#[test]
fn test_withdraw_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset, &100, &String::from_str(&env, ""));

    let result = client.try_withdraw(&pid, &asset, &200);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_withdraw_full_exit_deactivates_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset, &100, &String::from_str(&env, ""));
    client.withdraw(&pid, &asset, &100);

    let portfolio = client.get_portfolio(&pid);
    assert!(!portfolio.is_active);
    assert!(!portfolio.current_balances.contains_key(asset));
}

#[test]
fn test_admin_force_rebalance_bypasses_cooldown() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset, &100, &String::from_str(&env, ""));

    env.ledger().with_mut(|li| {
        li.timestamp = 10010;
    });

    let actual_balances = Map::new(&env);
    client.admin_force_rebalance(&pid, &actual_balances);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 10010);
}

#[test]
fn test_portfolio_invariants_helper_rejects_invalid_allocations() {
    let env = Env::default();
    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 4000);
    allocations.set(Address::generate(&env), 4000);
    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations.clone(),
        current_balances: Map::new(&env),
        asset_decimals: allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS),
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value: 0,
        is_active: true,
        pause_reason: PauseReason::None,
    };
    assert_eq!(
        crate::portfolio::check_portfolio_invariants(&portfolio),
        Err(Error::InvariantViolation)
    );
}

fn assert_cost_within_tolerance(name: &str, cpu: u64, mem: u64, baseline_cpu: u64, baseline_mem: u64) {
    let cpu_limit = baseline_cpu + (baseline_cpu * BENCHMARK_TOLERANCE_PERCENT / 100);
    let mem_limit = baseline_mem + (baseline_mem * BENCHMARK_TOLERANCE_PERCENT / 100);

    assert!(
        cpu <= cpu_limit,
        "CPU instruction usage exceeded threshold: actual={}, baseline={}, max_allowed={}",
        cpu, baseline_cpu, cpu_limit
    );
    assert!(
        mem <= mem_limit,
        "Memory usage exceeded threshold: actual={}, baseline={}, max_allowed={}",
        mem, baseline_mem, mem_limit
    );
}

#[test]
fn benchmark_initialize_gas() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();
    env.budget().reset_tracker();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let _ = client.initialize(&admin, &reflector_id);
    assert_cost_within_tolerance(
        "initialize",
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost(),
        BASELINE_INITIALIZE_CPU,
        BASELINE_INITIALIZE_MEM,
    );
}

#[test]
fn benchmark_create_portfolio_gas() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let _ = client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 10000);

    env.budget().reset_tracker();
    let _ = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    assert_cost_within_tolerance(
        "create_portfolio",
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost(),
        BASELINE_CREATE_PORTFOLIO_CPU,
        BASELINE_CREATE_PORTFOLIO_MEM,
    );
}

#[test]
fn benchmark_execute_rebalance_gas() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    env.ledger().with_mut(|li| {
        li.timestamp = 10_000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let _ = client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);

    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.ledger().with_mut(|li| {
        li.timestamp = 15_000;
    });

    env.budget().reset_tracker();
    let _ = client.execute_rebalance(&pid, &Map::new(&env));
    assert_cost_within_tolerance(
        "execute_rebalance",
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost(),
        BASELINE_EXECUTE_REBALANCE_CPU,
        BASELINE_EXECUTE_REBALANCE_MEM,
    );
}

#[test]
fn benchmark_deposit_gas() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let _ = client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.budget().reset_tracker();
    client.deposit(&pid, &asset, &100, &String::from_str(&env, ""));
    assert_cost_within_tolerance(
        "deposit",
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost(),
        BASELINE_DEPOSIT_CPU,
        BASELINE_DEPOSIT_MEM,
    );
}

// ── Issue #861: rebalance validates allocation sum ──────────────────────

#[test]
fn test_rebalance_rejects_invalid_allocation_sum() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    // Create with valid allocations first
    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    // Corrupt stored allocations via as_contract so they don't sum to 10000
    env.as_contract(&contract_id, || {
        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(pid))
            .unwrap();
        portfolio.target_allocations.set(asset, 9900);
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(pid), &portfolio);
    });

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(result, Err(Ok(Error::InvalidAllocationSum)));
}

// ── Issue #862: portfolio value in USD view function ────────────────────

#[test]
fn test_get_portfolio_value_usd_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &100, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &100, &String::from_str(&env, ""));

    let valuation = client.get_portfolio_value_usd(&pid);
    assert!(valuation.total_usd_value > 0);
    assert_eq!(valuation.assets.len(), 2);
}

#[test]
fn test_get_portfolio_value_usd_drift() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    // Deposit unequal amounts to create drift
    client.deposit(&pid, &asset1, &200, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &100, &String::from_str(&env, ""));

    let valuation = client.get_portfolio_value_usd(&pid);
    assert!(valuation.total_usd_value > 0);

    // At least one asset should have non-zero drift
    let mut has_drift = false;
    for i in 0..valuation.assets.len() {
        let av = valuation.assets.get(i).unwrap();
        if av.drift != 0 {
            has_drift = true;
        }
    }
    assert!(has_drift);
}

#[test]
fn test_get_portfolio_value_usd_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let result = client.try_get_portfolio_value_usd(&999);
    assert_eq!(result, Err(Ok(Error::PortfolioNotFound)));
}

// ── Issue #859: fractional allocation (basis points) ────────────────────

#[test]
fn test_fractional_allocation_three_way_equal() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let a3 = Address::generate(&env);
    // 33.33% + 33.33% + 33.34% = 100.00%
    allocations.set(a1, 3333);
    allocations.set(a2, 3333);
    allocations.set(a3, 3334);

    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    assert!(pid > 0);
}

#[test]
fn test_get_config_view_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let config_view = client.get_config_view(&pid);

    assert_eq!(config_view.admin, admin);
    assert_eq!(config_view.reflector_address, reflector_id);
    assert_eq!(config_view.emergency_stop, false);

    let portfolio = match config_view.portfolio {
        PortfolioOption::Some(p) => p,
        PortfolioOption::None => panic!("Expected PortfolioOption::Some"),
    };
    assert_eq!(portfolio.user, user);
    assert_eq!(portfolio.rebalance_threshold, 5);
    assert_eq!(portfolio.slippage_tolerance, 50);
}

#[test]
fn test_get_config_view_no_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let config_view = client.get_config_view(&999);

    assert_eq!(config_view.admin, admin);
    assert_eq!(config_view.reflector_address, reflector_id);
    assert_eq!(config_view.emergency_stop, false);
    assert_eq!(config_view.portfolio, PortfolioOption::None);
}

#[test]
fn test_get_config_view_emergency_stop() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reflector_id);
    client.set_emergency_stop(&true);

    let config_view = client.get_config_view(&1);

    assert_eq!(config_view.admin, admin);
    assert_eq!(config_view.reflector_address, reflector_id);
    assert_eq!(config_view.emergency_stop, true);
    assert_eq!(config_view.portfolio, PortfolioOption::None);
}
