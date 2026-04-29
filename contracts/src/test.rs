use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    vec, Address, Env, IntoVal, Map,
};

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
                    // Simple mock: based on last byte of address to give different prices
                    // 100 * 10^14 base price
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
    // Set sequence > 0 so portfolio_id > 0
    env.ledger().with_mut(|li| {
        li.sequence_number = 1;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    // reflector_id is already an Address
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin, &reflector_id);

    // Create portfolio
    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1, 50);
    allocations.set(asset2, 50);

    let portfolio_id = client.create_portfolio(&user, &allocations, &5, &50);

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
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    client.deposit(&pid, &asset, &1000);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset).unwrap(), 1000);
}

#[test]
#[should_panic(expected = "Amount must be positive")]
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
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    client.deposit(&pid, &asset, &0);
}

#[test]
fn test_check_rebalance_needed_no_drift() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup timestamps
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
    let asset1 = Address::generate(&env); // Price 100
    let asset2 = Address::generate(&env); // Price 100
    allocations.set(asset1.clone(), 50);
    allocations.set(asset2.clone(), 50);

    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    // Deposit equal amounts to have 50/50 split (allocations 50/50)
    // Both mocked assets have price 100
    client.deposit(&pid, &asset1, &100);
    client.deposit(&pid, &asset2, &100);

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
    allocations.set(asset1.clone(), 50);
    allocations.set(asset2.clone(), 50);

    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    // Create significant drift
    // Asset1: 200 units * 100 price = 20000 val
    // Asset2: 100 units * 100 price = 10000 val
    // Total = 30000.
    // Asset1: 66.6%, Target 50% -> Drift 16.6% > 5%
    client.deposit(&pid, &asset1, &200);
    client.deposit(&pid, &asset2, &100);

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
    allocations.set(asset, 100);

    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    // Set timestamp way past last_rebalance (which was 10000 at creation)
    env.ledger().with_mut(|li| {
        li.timestamp = 20000;
    });

    let actual_balances = Map::new(&env);
    client.execute_rebalance(&pid, &actual_balances);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 20000);
}

#[test]
#[should_panic(expected = "Cooldown active")]
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
    allocations.set(asset, 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    // Try to rebalance immediately (default last_rebalance is timestamp at creation)
    env.ledger().with_mut(|li| {
        li.timestamp = 10010;
    });

    let actual_balances = Map::new(&env);
    client.execute_rebalance(&pid, &actual_balances);
}

#[test]
#[should_panic(expected = "Emergency stop active")]
fn test_emergency_stop() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    client.set_emergency_stop(&true);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 100);

    let pid = client.create_portfolio(&user, &allocations, &5, &50);
    client.deposit(&pid, &asset, &100);
}

#[test]
#[should_panic(expected = "Stale price data")]
fn test_stale_data() {
    let env = Env::default();
    env.mock_all_auths();

    // Initial time
    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    // We can't easily mock "stale" data with just one mock impl unless we make it stateful or allow setting it.
    // For this test, notice our mock uses `env.ledger().timestamp()` for price timestamp.
    // So if we create the portfolio (and reflector checks env time), then advance time significantly
    // without "updating" the reflector (reflector always returns current env time in simple mock),
    // wait... in the simple mock `lastprice` returns `env.ledger().timestamp()`.
    // So to simulate stale data, we need a MockReflector that returns OLD timestamps.
    // Since we can't easily swap mocks or change logic dynamically in this simple setup without complex mocking,
    // we can rely on verifying the *logic* in other ways or make the Mock configurable.
    //
    // Let's create a separate StaleMockReflector for this test.

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
                // Return data from 2 hours ago (7200s)
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

    let stale_reflector_id = env.register_contract(None, stale_reflector::StaleReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &stale_reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    // Advance time to pass cooldown so that's not the error
    env.ledger().with_mut(|li| {
        li.timestamp = 20000;
    });

    let actual_balances = Map::new(&env);
    client.execute_rebalance(&pid, &actual_balances);
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
    allocations.set(asset, 100);

    let pid = client.create_portfolio(&Address::generate(&env), &allocations, &5, &50);
    // Single asset should never need rebalancing if it's 100%?
    // Well, technically drift is 0.
    assert!(!client.check_rebalance_needed(&pid));
}

#[test]
fn test_portfolio_validation() {
    let env = Env::default();
    let mut allocations = Map::new(&env);

    // Test valid allocation (sums to 100)
    allocations.set(Address::generate(&env), 60);
    allocations.set(Address::generate(&env), 40);
    assert!(crate::portfolio::validate_allocations(&allocations));

    // Test invalid allocation (doesn't sum to 100)
    let mut invalid_allocations = Map::new(&env);
    invalid_allocations.set(Address::generate(&env), 60);
    invalid_allocations.set(Address::generate(&env), 30);
    assert!(!crate::portfolio::validate_allocations(
        &invalid_allocations
    ));
}

fn allocation_map_from_percentages(env: &Env, percentages: &[u32]) -> Map<Address, u32> {
    let mut allocations = Map::new(env);
    for percentage in percentages {
        allocations.set(Address::generate(env), *percentage);
    }
    allocations
}

fn random_percentages_with_target_sum(seed: &mut u64, count: usize, target_sum: u32) -> [u32; 12] {
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
fn test_validate_allocations_randomized_sum_100_accepts_500_vectors() {
    let env = Env::default();
    let mut seed = 0xC0FFEEu64;
    for _ in 0..500 {
        let mut adjusted = [0u32; 10];
        let mut remaining = 100u32;
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
fn test_validate_allocations_randomized_sum_99_rejects_500_vectors() {
    let env = Env::default();
    let mut seed = 0xBAD5EEDu64;
    for _ in 0..500 {
        let raw = random_percentages_with_target_sum(&mut seed, 10, 99);
        let allocations = allocation_map_from_percentages(&env, &raw[..10]);
        assert!(!crate::portfolio::validate_allocations(&allocations));
    }
}

#[test]
fn test_validate_allocations_randomized_sum_101_rejects_500_vectors() {
    let env = Env::default();
    let mut seed = 0xDEADBEEFu64;
    for _ in 0..500 {
        let raw = random_percentages_with_target_sum(&mut seed, 10, 101);
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
fn test_validate_allocations_single_asset_hundred_percent_boundary() {
    let env = Env::default();
    let allocations = allocation_map_from_percentages(&env, &[100]);
    assert!(crate::portfolio::validate_allocations(&allocations));
}

#[test]
fn test_validate_allocations_ten_plus_assets_fractional_style_boundary() {
    let env = Env::default();
    // 11 assets with uneven integer percentages to mimic fractional weighting intent.
    let allocations = allocation_map_from_percentages(&env, &[9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 10]);
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
    for (asset, percentage) in allocations {
        target_allocations.set(asset.clone(), *percentage);
    }
    let mut current_balances = Map::new(env);
    for (asset, balance) in balances {
        current_balances.set(asset.clone(), *balance);
    }
    Portfolio {
        user: Address::generate(env),
        target_allocations,
        current_balances,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        last_rebalance: 0,
        total_value,
        is_active: true,
    }
}

#[test]
fn test_calculate_rebalance_trades_excludes_below_minimum_stroops() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let asset3 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 100);
    allocations.set(asset2.clone(), 100);
    allocations.set(asset3.clone(), 100);

    let target_balance = 50_000_000i128;
    let mut balances = Map::new(&env);
    balances.set(asset1.clone(), target_balance - (MIN_TRADE_AMOUNT_STROOPS / 2));
    balances.set(asset2.clone(), target_balance - MIN_TRADE_AMOUNT_STROOPS);
    balances.set(
        asset3.clone(),
        target_balance - (MIN_TRADE_AMOUNT_STROOPS + 1),
    );

    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        last_rebalance: 0,
        total_value: target_balance,
        is_active: true,
    };

    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 10i128.pow(14));
    prices.set(asset2.clone(), 10i128.pow(14));
    prices.set(asset3.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);
    assert!(!trades.contains_key(asset1));
    assert!(!trades.contains_key(asset2));
    assert_eq!(
        trades.get(asset3).unwrap(),
        MIN_TRADE_AMOUNT_STROOPS + 1
    );
}

#[test]
fn test_calculate_rebalance_trades_2_asset() {
    let env = Env::default();
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 50);
    allocations.set(asset2.clone(), 50);

    let mut balances = Map::new(&env);
    balances.set(asset1.clone(), 150 * 10i128.pow(14));
    balances.set(asset2.clone(), 50 * 10i128.pow(14));

    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        last_rebalance: 0,
        total_value: 200 * 10i128.pow(14),
        is_active: true,
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
        &[(asset1.clone(), 50), (asset2.clone(), 50)],
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
    allocations.set(a1.clone(), 20);
    allocations.set(a2.clone(), 20);
    allocations.set(a3.clone(), 20);
    allocations.set(a4.clone(), 20);
    allocations.set(a5.clone(), 20);

    let mut balances = Map::new(&env);
    balances.set(a1.clone(), 50 * 10i128.pow(14));
    balances.set(a2.clone(), 150 * 10i128.pow(14));
    balances.set(a3.clone(), 100 * 10i128.pow(14));
    balances.set(a4.clone(), 20 * 10i128.pow(14));
    balances.set(a5.clone(), 180 * 10i128.pow(14));

    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        last_rebalance: 0,
        total_value: 500 * 10i128.pow(14),
        is_active: true,
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
    allocations.set(asset1.clone(), 50);
    allocations.set(asset2.clone(), 50);

    let mut balances = Map::new(&env);
    balances.set(asset1.clone(), 120 * 10i128.pow(14)); // overweight
    balances.set(asset2.clone(), 80 * 10i128.pow(14));  // underweight

    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        last_rebalance: 0,
        total_value: 200 * 10i128.pow(14),
        is_active: true,
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
    allocations.set(asset1.clone(), 60);
    allocations.set(asset2.clone(), 40);

    let mut balances = Map::new(&env);
    balances.set(asset1.clone(), 150 * 10i128.pow(14));
    balances.set(asset2.clone(), 125 * 10i128.pow(13)); // 12.5 units

    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        last_rebalance: 0,
        total_value: 100 * 10i128.pow(14),
        is_active: true,
    };

    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 50_000_000_000_000); // 0.5 * 10^14
    prices.set(asset2.clone(), 200_000_000_000_000); // 2.0 * 10^14

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);
    
    assert_eq!(trades.get(asset1).unwrap(), -30 * 10i128.pow(14));
    assert_eq!(trades.get(asset2).unwrap(), 75 * 10i128.pow(13)); // 7.5 * 10^14
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
            (asset1.clone(), 50),
            (asset2.clone(), 30),
            (asset3.clone(), 20),
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
    allocations.set(asset1.clone(), 40);
    allocations.set(asset2.clone(), 30);
    allocations.set(asset3.clone(), 30);

    let mut balances = Map::new(&env);
    let target1 = 40_000_000i128;
    let target2 = 30_000_000i128;
    let target3 = 30_000_000i128;

    balances.set(asset1.clone(), target1 - MIN_TRADE_AMOUNT_STROOPS);
    balances.set(asset2.clone(), target2 - (MIN_TRADE_AMOUNT_STROOPS - 1));
    balances.set(asset3.clone(), target3 - (MIN_TRADE_AMOUNT_STROOPS + 1));

    let portfolio = Portfolio {
        user: Address::generate(&env),
        target_allocations: allocations,
        current_balances: balances,
        rebalance_threshold: 5,
        slippage_tolerance: 50,
        last_rebalance: 0,
        total_value: 100_000_000i128,
        is_active: true,
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
            (a1.clone(), 20),
            (a2.clone(), 20),
            (a3.clone(), 20),
            (a4.clone(), 20),
            (a5.clone(), 20),
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
    for asset in vec![&env, a1.clone(), a2.clone(), a3.clone(), a4.clone(), a5.clone()].iter() {
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
        &[(asset1.clone(), 50), (asset2.clone(), 50)],
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
    let expected_target_value = (portfolio.total_value * 50) / 100;
    let expected_target_balance = (expected_target_value * 10i128.pow(14)) / precise_price;
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
    // Second call must fail
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
    allocations.set(Address::generate(&env), 60);
    allocations.set(Address::generate(&env), 30); // sums to 90, not 100
    client.create_portfolio(&user, &allocations, &5, &50);
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
    allocations.set(Address::generate(&env), 100);
    client.create_portfolio(&user, &allocations, &0, &50);
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
    allocations.set(Address::generate(&env), 100);
    client.create_portfolio(&user, &allocations, &51, &50);
}

#[test]
fn test_create_portfolio_multiple_same_ledger() {
    let env = Env::default();
    env.mock_all_auths();
    // Simulate same ledger
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
    allocations.set(Address::generate(&env), 100);

    // Call twice in same sequence state
    let pid1 = client.create_portfolio(&user, &allocations, &5, &50);
    let pid2 = client.create_portfolio(&user, &allocations, &5, &50);

    assert_eq!(pid1, 1, "First portfolio ID should start at 1");
    assert_eq!(pid2, 2, "Second portfolio ID should be 2");
    assert_ne!(
        pid1, pid2,
        "Portfolio IDs must be unique even in the same ledger"
    );
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
    allocations.set(Address::generate(&env), 100);
    client.create_portfolio(&user, &allocations, &5, &9);
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
    allocations.set(Address::generate(&env), 100);
    client.create_portfolio(&user, &allocations, &5, &501);
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
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    client.set_emergency_stop(&true);

    client.set_emergency_stop(&false);

    client.deposit(&pid, &asset, &100);
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset).unwrap(), 100);
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
fn test_emergency_stop_reactivation_snapshot() {
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
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    // Pause
    client.set_emergency_stop(&true);
    
    // Reactivate
    client.set_emergency_stop(&false);
    
    // Resume operations
    client.deposit(&pid, &asset, &100);
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset).unwrap(), 100);
}

#[test]
#[should_panic]
fn test_emergency_stop_non_admin_snapshot_captured() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    
    client.mock_all_auths().initialize(&admin, &reflector_id);
    
    // Non-admin auth should be rejected by require_auth on the admin address
    client.mock_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "set_emergency_stop",
            args: vec![&env, true.into_val(&env)],
            sub_invokes: &[],
        },
    }]).set_emergency_stop(&true);
}

#[test]
fn test_calculate_portfolio_value_all_prices_available() {
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
    allocations.set(asset1.clone(), 50);
    allocations.set(asset2.clone(), 50);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);
    client.deposit(&pid, &asset1, &100);
    client.deposit(&pid, &asset2, &50);

    let portfolio = client.get_portfolio(&pid);
    let reflector_client = ReflectorClient::new(&env, &reflector_id);
    let value =
        crate::portfolio::calculate_portfolio_value(&env, &portfolio.current_balances, &reflector_client);
    assert_eq!(value, Some(15000));
}

#[test]
fn test_calculate_portfolio_value_missing_price_skips_asset() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_with_missing_price::ReflectorWithMissingPrice);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let priced_asset = Address::generate(&env);
    let missing_asset = Address::generate(&env);
    let missing_price_reflector =
        reflector_with_missing_price::ReflectorWithMissingPriceClient::new(&env, &reflector_id);
    missing_price_reflector.set_missing_asset(&missing_asset);
    allocations.set(priced_asset.clone(), 50);
    allocations.set(missing_asset.clone(), 50);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);
    client.deposit(&pid, &priced_asset, &100);
    client.deposit(&pid, &missing_asset, &100);

    let portfolio = client.get_portfolio(&pid);
    let reflector_client = ReflectorClient::new(&env, &reflector_id);
    let value =
        crate::portfolio::calculate_portfolio_value(&env, &portfolio.current_balances, &reflector_client);

    assert_eq!(value, None); // Should be None now that we don't skip
}

#[test]
fn test_calculate_portfolio_value_all_prices_missing_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_without_prices::ReflectorWithoutPrices);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);
    client.deposit(&pid, &asset, &100);

    let portfolio = client.get_portfolio(&pid);
    let reflector_client = ReflectorClient::new(&env, &reflector_id);
    let value =
        crate::portfolio::calculate_portfolio_value(&env, &portfolio.current_balances, &reflector_client);
    assert_eq!(value, None); // Should be None if all missing
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
        max_allocations.set(Address::generate(&env), 100 / MAX_PORTFOLIO_ASSETS);
    }
    let pid = client.create_portfolio(&user, &max_allocations, &5, &50);
    assert!(pid > 0);

    let mut too_many_allocations = Map::new(&env);
    for _ in 0..20u32 {
        too_many_allocations.set(Address::generate(&env), 5);
    }
    let result = client.try_create_portfolio(&user, &too_many_allocations, &5, &50);
    assert_eq!(result, Err(Ok(Error::TooManyAssets)));
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
    allocations.set(Address::generate(&env), 100);

    env.budget().reset_tracker();
    let _ = client.create_portfolio(&user, &allocations, &5, &50);
    assert_cost_within_tolerance(
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
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);
    client.deposit(&pid, &asset, &100);

    env.ledger().with_mut(|li| {
        li.timestamp = 20_000;
    });

    env.budget().reset_tracker();
    let _ = client.execute_rebalance(&pid, &Map::new(&env));
    assert_cost_within_tolerance(
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
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5, &50);

    env.budget().reset_tracker();
    client.deposit(&pid, &asset, &100);
    assert_cost_within_tolerance(
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost(),
        BASELINE_DEPOSIT_CPU,
        BASELINE_DEPOSIT_MEM,
    );
}

fn assert_cost_within_tolerance(cpu: u64, mem: u64, baseline_cpu: u64, baseline_mem: u64) {
    let cpu_limit = baseline_cpu + (baseline_cpu * BENCHMARK_TOLERANCE_PERCENT / 100);
    let mem_limit = baseline_mem + (baseline_mem * BENCHMARK_TOLERANCE_PERCENT / 100);
    assert!(
        cpu <= cpu_limit,
        "CPU instruction usage exceeded threshold: actual={}, baseline={}, max_allowed={}",
        cpu,
        baseline_cpu,
        cpu_limit
    );
    assert!(
        mem <= mem_limit,
        "Memory usage exceeded threshold: actual={}, baseline={}, max_allowed={}",
        mem,
        baseline_mem,
        mem_limit
    );
}
