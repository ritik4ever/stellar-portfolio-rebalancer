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

#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, Map};

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]
        
        #[test]
        fn test_validate_allocations_random_sums(
            // Generate a vector of 1-15 percentages
            percentages in prop::collection::vec(0u32..200u32, 1..15)
        ) {
            let env = Env::default();
            let mut allocations = Map::new(&env);
            let mut expected_total = 0u32;
            
            for p in percentages {
                allocations.set(Address::generate(&env), p);
                expected_total += p;
            }
            
            let is_valid = crate::portfolio::validate_allocations(&allocations);
            if expected_total == 100 {
                assert!(is_valid, "Should be valid when total is 100");
            } else {
                assert!(!is_valid, "Should be invalid when total is {} (not 100)", expected_total);
            }
        }

        #[test]
        fn test_validate_allocations_sum_100_fixed_count(
            count in 1usize..15usize
        ) {
            let env = Env::default();
            let mut allocations = Map::new(&env);
            
            // Distribute 100 across 'count' assets
            let mut remaining = 100u32;
            for i in 0..count {
                let val = if i == count - 1 {
                    remaining
                } else {
                    // Random value between 0 and remaining
                    // Since proptest doesn't easily support dependent generators here without flat_map,
                    // we'll just use a simple deterministic distribution for this specific test
                    // or just use a simpler way.
                    remaining / (count as u32 - i as u32)
                };
                allocations.set(Address::generate(&env), val);
                remaining -= val;
            }
            
            assert!(crate::portfolio::validate_allocations(&allocations), "Total should be 100");
        }
    }

    #[test]
    fn test_validate_allocations_empty() {
        let env = Env::default();
        let allocations = Map::new(&env);
        assert!(!crate::portfolio::validate_allocations(&allocations), "Empty allocations should be invalid");
    }

    #[test]
    fn test_validate_allocations_single_asset_100() {
        let env = Env::default();
        let mut allocations = Map::new(&env);
        allocations.set(Address::generate(&env), 100);
        assert!(crate::portfolio::validate_allocations(&allocations), "Single asset 100% should be valid");
    }

    #[test]
    fn test_validate_allocations_multi_asset_fractional() {
        let env = Env::default();
        let mut allocations = Map::new(&env);
        // 10 assets with 10% each
        for _ in 0..10 {
            allocations.set(Address::generate(&env), 10);
        }
        assert!(crate::portfolio::validate_allocations(&allocations), "10 assets with 10% each should be valid");
    }
}
