extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    vec, Address, Bytes, Env, IntoVal, Map, String, TryFromVal, Val,
};

fn allocation_decimals(
    env: &Env,
    allocations: &Map<Address, u32>,
    decimals: u32,
) -> Map<Address, u32> {
    let mut asset_decimals = Map::new(env);
    for (asset, _) in allocations.iter() {
        asset_decimals.set(asset, decimals);
    }
    asset_decimals
}

fn create_token_and_mint(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let token_id = env.register_stellar_asset_contract(admin.clone());
    let token = StellarAssetClient::new(env, &token_id);
    token.mint(to, &amount);
    token_id
}
/// Scan the raw host event log (including events emitted during failed calls)
/// for a contract event whose first topic matches `symbol`.
///
/// `all_events()` relies on `env.events().all()`, which drops events that were
/// emitted inside a *failed* contract invocation (`failed_call`). The circuit
/// breaker emits its event right before returning `Err(EmergencyStop)` from
/// `check_volatility`, so those events are only visible via `env.host()`.
fn has_host_event(env: &Env, symbol: &str) -> bool {
    let host_events = env.host().get_events().unwrap().0;
    for host_event in host_events.iter() {
        if let soroban_sdk::xdr::ContractEventBody::V0(v0) = &host_event.event.body {
            if let Some(scval) = v0.topics.first() {
                if let Ok(sym) =
                    Symbol::try_from_val(env, &Val::try_from_val(env, scval).unwrap())
                {
                    if sym == Symbol::new(env, symbol) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn all_events(env: &Env) -> std::vec::Vec<(Address, Vec<Val>, Val)> {
    // `env.events().all()` returns an XDR-backed `ContractEvents` value with no
    // iterator, so convert each event into the `(contract_id, topics, data)`
    // tuple form used by the assertions below.
    env.events()
        .all()
        .events()
        .iter()
        .map(|e| {
            let contract_id = Address::try_from_val(
                env,
                &soroban_sdk::xdr::ScAddress::Contract(
                    e.contract_id
                        .clone()
                        .expect("contract event has a contract id"),
                ),
            )
            .unwrap();
            let body = match &e.body {
                soroban_sdk::xdr::ContractEventBody::V0(v0) => v0,
                _ => unreachable!("only V0 contract events are emitted"),
            };
            let mut topics: Vec<Val> = Vec::new(env);
            for scval in body.topics.iter() {
                topics.push_back(Val::try_from_val(env, scval).unwrap());
            }
            let data = Val::try_from_val(env, &body.data).unwrap();
            (contract_id, topics, data)
        })
        .collect()
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
const BASELINE_EXECUTE_REBALANCE_MAX_ASSETS_CPU: u64 = 10_000_000; // Will adjust later
const BASELINE_EXECUTE_REBALANCE_MAX_ASSETS_MEM: u64 = 1_000_000; // Will adjust later
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
                Asset::Stellar(_addr) => 100_00000000000000i128,
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

// A contract that does NOT implement the Reflector interface.
// Used to verify that initialize() rejects non-conforming addresses.
mod non_reflector_contract {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct NonReflector;

    #[contractimpl]
    impl NonReflector {
        pub fn hello(_env: Env) -> bool {
            true
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

    let asset = create_token_and_mint(&env, &admin, &user, 2000);

    let mut allocations = Map::new(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset, &1000, &String::from_str(&env, ""));

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset.clone()).unwrap(), 1000);

    let token = TokenClient::new(&env, &asset);
    assert_eq!(token.balance(&contract_id), 1000);
    assert_eq!(token.balance(&user), 1000);
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

    let asset1 = create_token_and_mint(&env, &admin, &user, 200);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200);

    let mut allocations = Map::new(&env);
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

    let asset1 = create_token_and_mint(&env, &admin, &user, 300);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200);

    let mut allocations = Map::new(&env);
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
fn test_batch_rebalance_mixed_success_and_failure() {
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

    let success_pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    // Create the cooldown portfolio at a later timestamp so its `last_rebalance`
    // is recent enough for the 3600s cooldown to still be active at t=15000.
    env.ledger().with_mut(|li| {
        li.timestamp = 12000;
    });
    let cooldown_pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    let results = client
        .batch_rebalance(&vec![&env, success_pid, 999, cooldown_pid]);

    assert_eq!(results.len(), 3);
    assert_eq!(results.get(0).unwrap().portfolio_id, success_pid);
    assert_eq!(
        results.get(0).unwrap().result,
        BatchRebalanceResultStatus::Success
    );
    assert_eq!(results.get(1).unwrap().portfolio_id, 999);
    assert_eq!(
        results.get(1).unwrap().result,
        BatchRebalanceResultStatus::Failed(Error::PortfolioNotFound)
    );
    assert_eq!(results.get(2).unwrap().portfolio_id, cooldown_pid);
    assert_eq!(
        results.get(2).unwrap().result,
        BatchRebalanceResultStatus::Failed(Error::CooldownActive)
    );

    assert_eq!(client.get_portfolio(&success_pid).last_rebalance, 15000);
}

// ─────────────────────────────────────────────────────────────────────
// resume_portfolio tests (issue #1334)
// ─────────────────────────────────────────────────────────────────────

#[test]
fn test_resume_portfolio_clears_pause_state() {
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

    // Pause first
    client.pause_portfolio(&pid, &PauseReason::UserPaused);
    let paused = client.get_portfolio(&pid);
    assert!(!paused.is_active);
    assert_eq!(paused.pause_reason, PauseReason::UserPaused);

    // Resume clears both flags
    client.resume_portfolio(&pid);
    let resumed = client.get_portfolio(&pid);
    assert!(resumed.is_active);
    assert_eq!(resumed.pause_reason, PauseReason::None);
}

#[test]
fn test_resume_portfolio_emits_event() {
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
    client.resume_portfolio(&pid);

    let events = all_events(&env);
    let resumed_event = events.iter().rev().find(|(_, topics, _)| {
        // The event topics are ("portfolio", "resumed") — look for the
        // second topic matching the string "resumed".
        topics.iter().any(|topic| {
            String::try_from_val(&env, &topic)
                .ok()
                .map_or(false, |s| s == String::from_str(&env, "resumed"))
        })
    });
    assert!(resumed_event.is_some(), "PortfolioResumed event must be emitted");
}

#[test]
fn test_pause_resume_rebalance_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 20_000;
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

    // 1. Pause — rebalance must fail
    client.pause_portfolio(&pid, &PauseReason::UserPaused);
    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(result, Err(Ok(Error::PortfolioPaused)));

    // 2. Resume — rebalance must succeed
    client.resume_portfolio(&pid);
    env.ledger().with_mut(|li| {
        li.timestamp = 25_000;
    });
    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(result, Ok(Ok(())));

    // Verify last_rebalance was updated
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 25_000);
    assert!(portfolio.is_active);
}

#[test]
#[should_panic]
fn test_resume_portfolio_unauthorized() {
    let env = Env::default();
    // Deliberately do NOT call env.mock_all_auths() so that
    // un-mocked require_auth() calls will panic.
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let stranger = Address::generate(&env);

    client.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "initialize",
            args: (&admin, &reflector_id).into_val(&env),
            sub_invokes: &[],
        },
    }]).initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);

    let pid = client.mock_auths(&[MockAuth {
        address: &user,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_portfolio",
            args: (&user, &allocations, &asset_decimals, 5u32, 50u32, CURRENT_SLIPPAGE_POLICY_VERSION).into_val(&env),
            sub_invokes: &[],
        },
    }]).create_portfolio(&user, &allocations, &asset_decimals, &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION);

    // Pause as user (authorized)
    client.mock_auths(&[MockAuth {
        address: &user,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause_portfolio",
            args: (&pid, &PauseReason::UserPaused).into_val(&env),
            sub_invokes: &[],
        },
    }]).pause_portfolio(&pid, &PauseReason::UserPaused);

    // Resume as stranger — should panic because stranger is not the
    // stored steward (user).  No mock_auth for user means
    // `user.require_auth()` fails.
    client.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "resume_portfolio",
            args: (&pid,).into_val(&env),
            sub_invokes: &[],
        },
    }]).resume_portfolio(&pid);
}

#[test]
fn test_steward_can_resume_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let steward = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    // Transfer stewardship so the steward can resume
    client.transfer_stewardship(&pid, &steward);

    // Pause as user
    client.pause_portfolio(&pid, &PauseReason::UserPaused);
    assert!(!client.get_portfolio(&pid).is_active);

    // Steward resumes — should succeed
    client.mock_auths(&[MockAuth {
        address: &steward,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "resume_portfolio",
            args: (&pid,).into_val(&env),
            sub_invokes: &[],
        },
    }]).resume_portfolio(&pid);
    assert!(client.get_portfolio(&pid).is_active);
    assert_eq!(client.get_portfolio(&pid).pause_reason, PauseReason::None);
}

#[test]
fn test_batch_rebalance_size_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let result = client.try_batch_rebalance(&vec![&env, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert_eq!(result, Err(Ok(Error::BatchTooLarge)));
}

#[test]
fn test_fee_config_supports_platform_name_and_zero_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let recipient = Address::generate(&env);
    let config = FeeConfig {
        platform_name: String::from_str(&env, "Acme Vault"),
        fee_bps: 0,
        fee_recipient: recipient.clone(),
        enabled: true,
    };

    client.set_fee_config(&config);

    // Fee config changes are timelocked: apply the queued config.
    env.ledger().with_mut(|li| {
        li.timestamp = TIMELOCK_DELAY_SECONDS + 1;
    });
    client.execute_fee_config();

    let persisted = client.get_fee_config();
    assert_eq!(
        persisted.platform_name,
        String::from_str(&env, "Acme Vault")
    );
    assert_eq!(persisted.fee_bps, 0);
    assert_eq!(persisted.fee_recipient, recipient);
    assert!(persisted.enabled);
}

#[test]
fn test_rebalance_applies_non_zero_fee_to_trade_amount() {
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

    let asset1 = create_token_and_mint(&env, &admin, &user, 10_000_000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 5_000_000);

    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);

    let recipient = Address::generate(&env);
    let config = FeeConfig {
        platform_name: String::from_str(&env, "Acme Vault"),
        fee_bps: 50,
        fee_recipient: recipient.clone(),
        enabled: true,
    };
    client.set_fee_config(&config);

    // Fee config changes are timelocked: apply the queued config before
    // creating the portfolio so the ledger-timestamp drift guard stays within
    // bounds for the subsequent rebalance.
    env.ledger().with_mut(|li| {
        li.timestamp = 10000 + TIMELOCK_DELAY_SECONDS + 1;
    });
    client.execute_fee_config();

    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset1, &10_000_000, &String::from_str(&env, ""));

    env.ledger().with_mut(|li| {
        li.timestamp += REBALANCE_COOLDOWN_SECONDS + 1;
    });

    client.execute_rebalance(&pid, &Map::new(&env));

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset1.clone()).unwrap(), 4_975_000);
    assert_eq!(portfolio.current_balances.get(asset2.clone()).unwrap(), 4_975_000);

    let token1 = TokenClient::new(&env, &asset1);
    let token2 = TokenClient::new(&env, &asset2);
    assert_eq!(token1.balance(&contract_id), 4_975_000);
    assert_eq!(token2.balance(&contract_id), 4_975_000);
    assert_eq!(token1.balance(&recipient), 25_000);
    assert_eq!(token2.balance(&recipient), 25_000);
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

    let asset = create_token_and_mint(&env, &admin, &user, 200);

    let mut allocations = Map::new(&env);
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
    let allocations = allocation_map_from_percentages(
        &env,
        &[1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    );
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
        circuit_breaker_config: CircuitBreakerConfig {
            spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
            window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
        },
        global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
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
        circuit_breaker_config: CircuitBreakerConfig {
            spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
            window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
        },
        global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
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
        circuit_breaker_config: CircuitBreakerConfig {
            spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
            window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
        },
        global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
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
        circuit_breaker_config: CircuitBreakerConfig {
            spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
            window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
        },
        global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
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
        circuit_breaker_config: CircuitBreakerConfig {
            spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
            window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
        },
        global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
    };

    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), 10i128.pow(14));
    prices.set(asset2.clone(), 10i128.pow(14));

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);

    let trade_a1 = trades.get(asset1).unwrap();
    let trade_a2 = trades.get(asset2).unwrap();

    assert!(
        trade_a1 < 0,
        "Overweight asset should result in a sell (negative) trade"
    );
    assert!(
        trade_a2 > 0,
        "Underweight asset should result in a buy (positive) trade"
    );
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
        circuit_breaker_config: CircuitBreakerConfig {
            spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
            window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
        },
        global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
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
        circuit_breaker_config: CircuitBreakerConfig {
            spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
            window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
        },
        global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
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
            (
                asset1.clone(),
                target_balance - (MIN_TRADE_AMOUNT_STROOPS + 5),
            ),
            (
                asset2.clone(),
                target_balance + (MIN_TRADE_AMOUNT_STROOPS + 5),
            ),
        ],
        246_913_578,
    );
    let mut prices = Map::new(&env);
    prices.set(asset1.clone(), precise_price);
    prices.set(asset2.clone(), precise_price);

    let trades = crate::portfolio::calculate_rebalance_trades(&env, &portfolio, &prices);
    let expected_target_value = (portfolio.total_value * 5000) / 10000;
    let expected_target_balance = crate::portfolio::value_to_balance(
        expected_target_value,
        precise_price,
        DEFAULT_ASSET_DECIMALS,
    );
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
fn test_initialize_rejects_invalid_reflector_address() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let non_reflector_id = env.register_contract(None, non_reflector_contract::NonReflector);
    let admin = Address::generate(&env);

    let result = client.try_initialize(&admin, &non_reflector_id);
    assert_eq!(result, Err(Ok(Error::InvalidOracleAddress)));
}

#[test]
fn test_initialize_accepts_valid_reflector_address() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);

    let result = client.try_initialize(&admin, &reflector_id);
    assert_eq!(result, Ok(Ok(())));
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
    let asset = create_token_and_mint(&env, &admin, &user, 100);
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
        max_allocations.set(
            Address::generate(&env),
            ALLOCATION_DENOMINATOR / MAX_PORTFOLIO_ASSETS,
        );
    }
    let pid = create_portfolio_with_defaults(&env, &client, &user, &max_allocations, 5, 50);
    assert!(pid > 0);

    let mut too_many_allocations = Map::new(&env);
    for _ in 0..20u32 {
        too_many_allocations.set(Address::generate(&env), 500);
    }
    let too_many_decimals =
        allocation_decimals(&env, &too_many_allocations, DEFAULT_ASSET_DECIMALS);
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
        &[
            (Address::generate(&env), 7000),
            (Address::generate(&env), 3000),
        ],
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

    let new_steward = Address::generate(&env);
    let mut allocations = Map::new(&env);
    let asset = create_token_and_mint(&env, &admin, &new_steward, 500);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.transfer_stewardship(&pid, &new_steward);

    // `mock_all_auths()` covers the steward auth and the token sub-invokes.
    client.deposit(&pid, &asset, &500, &String::from_str(&env, ""));

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
    let asset1 = create_token_and_mint(&env, &admin, &user, 20_000_000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 10_000_000);
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
    let asset = create_token_and_mint(&env, &admin, &user, 1000);
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
    assert_eq!(
        portfolio.slippage_policy_version,
        SLIPPAGE_POLICY_VERSION_V1
    );
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
    client
        .mock_auths(&[MockAuth {
            address: &unauthorized,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "transfer_stewardship",
                args: (pid, attacker.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .transfer_stewardship(&pid, &attacker);
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
fn test_capability_summary() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    
    assert_eq!(client.version(), CONTRACT_VERSION);
    assert_eq!(client.schema_version(), CONTRACT_EVENT_SCHEMA_VERSION);
    
    let summary = client.capability_summary();
    assert_eq!(summary.version, CONTRACT_VERSION);
    assert_eq!(summary.schema_version, CONTRACT_EVENT_SCHEMA_VERSION);
    assert!(summary.capability_flags & CapabilityFlag::PerPortfolioSteward as u32 != 0);
    assert!(summary.capability_flags & CapabilityFlag::DifferentiatedPricing as u32 != 0);
    assert!(summary.capability_flags & CapabilityFlag::EmergencyStop as u32 != 0);
    assert_eq!(summary.min_rebalance_threshold, 1);
    assert_eq!(summary.max_rebalance_threshold, 50);
    assert_eq!(summary.min_slippage_tolerance_bps, 10);
    assert_eq!(summary.max_slippage_tolerance_bps, 500);
    assert_eq!(summary.max_portfolio_assets, 10);
}

// // #[test]

fn test_missing_price_error() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let missing_reflector_id =
        env.register_contract(None, reflector_without_prices::ReflectorWithoutPrices);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &missing_reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.ledger().with_mut(|li| {
        li.timestamp = 20000;
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
    let asset = create_token_and_mint(&env, &admin, &user, 100);
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
        li.timestamp = 20_000;
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
    assert_eq!(
        client.get_contract_pause_reason(),
        PauseReason::AdminEmergency
    );

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
    let asset = create_token_and_mint(&env, &admin, &user, 100);
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
    let asset = create_token_and_mint(&env, &admin, &user, 1000);
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
    let asset = create_token_and_mint(&env, &admin, &user, 100);
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
    let asset = create_token_and_mint(&env, &admin, &user, 100);
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
    let asset1 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset1, &150_0000000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &50_0000000, &String::from_str(&env, ""));

    env.ledger().with_mut(|li| {
        li.timestamp = 10010;
    });

    let actual_balances = Map::new(&env);
    client.admin_force_rebalance(&admin, &pid, &actual_balances);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 10010);
}

#[test]
#[should_panic]
fn test_admin_force_rebalance_non_admin_rejected() {
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
    let actual_balances = Map::new(&env);
    client
        .mock_auths(&[MockAuth {
            address: &unauthorized,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "admin_force_rebalance",
                args: (unauthorized.clone(), pid, actual_balances.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .admin_force_rebalance(&unauthorized, &pid, &actual_balances);
}

#[test]
fn test_admin_force_rebalance_admin_success() {
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

    // `mock_all_auths()` (set above) covers both the admin auth required by
    // `admin_force_rebalance` and the portfolio user auth required by the
    // inner `execute_rebalance_internal`.
    let actual_balances = Map::new(&env);
    client.admin_force_rebalance(&admin, &pid, &actual_balances);
}

// ── Issue #1377: operator role, scoped to admin_force_rebalance ─────────

#[test]
fn test_operator_can_force_rebalance() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    assert!(!client.is_operator(&operator));
    client.add_operator(&operator);
    assert!(client.is_operator(&operator));

    let mut allocations = Map::new(&env);
    let asset1 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset1, &150_0000000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &50_0000000, &String::from_str(&env, ""));

    env.ledger().with_mut(|li| {
        li.timestamp = 10010;
    });

    let actual_balances = Map::new(&env);
    client.admin_force_rebalance(&operator, &pid, &actual_balances);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 10010);
}

#[test]
fn test_revoked_operator_rejected_from_force_rebalance() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.add_operator(&operator);
    client.remove_operator(&operator);
    assert!(!client.is_operator(&operator));

    let actual_balances = Map::new(&env);
    let result = client.try_admin_force_rebalance(&operator, &pid, &actual_balances);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_non_operator_rejected_from_force_rebalance() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let stranger = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let actual_balances = Map::new(&env);
    let result = client.try_admin_force_rebalance(&stranger, &pid, &actual_balances);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
#[should_panic]
fn test_operator_rejected_from_admin_only_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let operator = Address::generate(&env);
    client.add_operator(&operator);

    let new_wasm_hash = env.deployer().upload_contract_wasm(&[0u8; 0] as &[u8]);

    // Operators are scoped to `admin_force_rebalance` only: `queue_upgrade`
    // still fetches the real Admin from storage and requires auth from
    // exactly that address, so an operator-only auth mock fails here.
    client
        .mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "queue_upgrade",
                args: (new_wasm_hash.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .queue_upgrade(&new_wasm_hash);
}

#[test]
#[should_panic]
fn test_operator_rejected_from_admin_only_set_fee_config() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let operator = Address::generate(&env);
    client.add_operator(&operator);

    let config = FeeConfig {
        platform_name: String::from_str(&env, "test"),
        fee_bps: 25,
        fee_recipient: Address::generate(&env),
        enabled: true,
    };

    client
        .mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_fee_config",
                args: (config.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_fee_config(&config);
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
        circuit_breaker_config: CircuitBreakerConfig {
            spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
            window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
        },
        global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
    };
    assert_eq!(
        crate::portfolio::check_portfolio_invariants(&portfolio),
        Err(Error::InvariantViolation)
    );
}

fn assert_cost_within_tolerance(
    name: &str,
    cpu: u64,
    mem: u64,
    baseline_cpu: u64,
    baseline_mem: u64,
) {
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
    let asset = create_token_and_mint(&env, &admin, &user, 100);
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

#[test]
fn benchmark_execute_rebalance_max_assets() {
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
    for _ in 0..MAX_PORTFOLIO_ASSETS {
        allocations.set(Address::generate(&env), ALLOCATION_DENOMINATOR / MAX_PORTFOLIO_ASSETS);
    }
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    env.ledger().with_mut(|li| {
        li.timestamp = 15_000;
    });

    env.budget().reset_tracker();
    let _ = client.execute_rebalance(&pid, &Map::new(&env));
    
    std::println!("CPU used for max assets: {}", env.budget().cpu_instruction_cost());
    std::println!("MEM used for max assets: {}", env.budget().memory_bytes_cost());
    
    assert_cost_within_tolerance(
        "execute_rebalance_max_assets",
        env.budget().cpu_instruction_cost(),
        env.budget().memory_bytes_cost(),
        BASELINE_EXECUTE_REBALANCE_MAX_ASSETS_CPU,
        BASELINE_EXECUTE_REBALANCE_MAX_ASSETS_MEM,
    );
}

#[test]
fn test_execute_rebalance_max_assets_plus_one_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let _ = client.initialize(&admin, &reflector_id);

    let mut too_many_allocations = Map::new(&env);
    for _ in 0..MAX_PORTFOLIO_ASSETS {
        too_many_allocations.set(Address::generate(&env), 1);
    }
    // MAX_PORTFOLIO_ASSETS + 1 entries that sum to ALLOCATION_DENOMINATOR so
    // allocation-sum validation passes and the asset-count guard is exercised.
    too_many_allocations.set(
        Address::generate(&env),
        ALLOCATION_DENOMINATOR - MAX_PORTFOLIO_ASSETS,
    );
    
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

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    // Corrupt stored allocations via as_contract so they don't sum to 10000
    env.as_contract(&contract_id, || {
        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::PortfolioV2(pid))
            .unwrap();
        portfolio.target_allocations.set(asset.clone(), 9900);
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(pid), &portfolio);
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
    let asset1 = create_token_and_mint(&env, &admin, &user, 100);
    let asset2 = create_token_and_mint(&env, &admin, &user, 100);
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
    let asset1 = create_token_and_mint(&env, &admin, &user, 200);
    let asset2 = create_token_and_mint(&env, &admin, &user, 100);
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

// ── get_drift_preview tests ──────────────────────────────────────────────────

#[test]
fn test_get_drift_preview_balanced_no_needs_rebalance() {
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
    let asset1 = create_token_and_mint(&env, &admin, &user, 100);
    let asset2 = create_token_and_mint(&env, &admin, &user, 100);
    allocations.set(asset1.clone(), 5000u32);
    allocations.set(asset2.clone(), 5000u32);

    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    // Deposit equal amounts at equal oracle prices → zero drift.
    client.deposit(&pid, &asset1, &100i128, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &100i128, &String::from_str(&env, ""));

    let drifts = client.get_drift_preview(&pid);
    assert_eq!(drifts.len(), 2);
    for i in 0..drifts.len() {
        let d = drifts.get(i).unwrap();
        assert_eq!(d.target_pct, 5000u32);
        assert_eq!(d.current_pct, 5000u32);
        assert_eq!(d.drift_pct, 0u32);
        assert!(!d.needs_rebalance, "balanced portfolio should not need rebalance");
    }
}

#[test]
fn test_get_drift_preview_imbalanced_needs_rebalance() {
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
    let asset1 = create_token_and_mint(&env, &admin, &user, 900);
    let asset2 = create_token_and_mint(&env, &admin, &user, 100);
    allocations.set(asset1.clone(), 5000u32);
    allocations.set(asset2.clone(), 5000u32);

    // Use a tight threshold (1 %) so even small imbalance triggers rebalance.
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 1, 50);

    // Deposit very unequal amounts to create a large drift.
    client.deposit(&pid, &asset1, &900i128, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &100i128, &String::from_str(&env, ""));

    let drifts = client.get_drift_preview(&pid);
    assert_eq!(drifts.len(), 2);

    // At least one asset must report needs_rebalance == true.
    let any_needs = drifts.iter().any(|d| d.needs_rebalance);
    assert!(any_needs, "imbalanced portfolio must have at least one asset needing rebalance");

    // drift_pct must be the same as what build_rebalance_preview computes via
    // preview_rebalance threshold_decisions — cross-check via preview_rebalance.
    let preview = client.preview_rebalance(&pid);
    for i in 0..drifts.len() {
        let d = drifts.get(i).unwrap();
        let td = preview.threshold_decisions.get(d.asset.clone()).unwrap();
        assert_eq!(d.current_pct, td.current_percent, "current_pct must match preview");
        assert_eq!(d.drift_pct, td.drift, "drift_pct must match preview threshold_decision");
        assert_eq!(d.needs_rebalance, td.exceeds_threshold, "needs_rebalance must match preview");
    }
}

#[test]
fn test_get_drift_preview_unknown_portfolio_returns_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    // portfolio_id 9999 was never created.
    let drifts = client.get_drift_preview(&9999u64);
    assert_eq!(drifts.len(), 0, "unknown portfolio must return empty vec, not panic");
}

// ── NAV snapshot and history tests ──────────────────────────────────────────

#[test]
fn test_manual_nav_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = create_token_and_mint(&env, &admin, &user, 100_0000000);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    // Deposit some balance so total value is non-zero
    client.deposit(&pid, &asset, &100_0000000, &String::from_str(&env, "initial"));

    // Set sequence and timestamp
    env.ledger().with_mut(|li| {
        li.sequence_number = 123;
        li.timestamp = 456;
    });

    let snapshot = client.snapshot_nav(&pid);
    assert_eq!(snapshot.usd_nav, 100_000000000); // 100 * 100 USD (which is 100_000000000 USD stroops)
    assert_eq!(snapshot.sequence, 123);
    assert_eq!(snapshot.timestamp, 456);

    let history = client.get_nav_history(&pid, &10);
    assert_eq!(history.len(), 1);
    let snap_in_history = history.get(0).unwrap();
    assert_eq!(snap_in_history.usd_nav, 100_000000000);
    assert_eq!(snap_in_history.sequence, 123);
    assert_eq!(snap_in_history.timestamp, 456);
}

#[test]
fn test_nav_history_limit_and_eviction() {
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

    // Call snapshot_nav 105 times, updating timestamp/sequence
    for i in 0..105 {
        env.ledger().with_mut(|li| {
            li.sequence_number = i as u32 + 1;
            li.timestamp = i as u64 + 10;
        });
        let _ = client.snapshot_nav(&pid);
    }

    // Limit is 100. So history length should be exactly 100.
    let history = client.get_nav_history(&pid, &200);
    assert_eq!(history.len(), 100);

    // The oldest stored snapshot should be sequence 6 (since 105 total snapshots, first 5 were evicted)
    assert_eq!(history.get(0).unwrap().sequence, 6);
    assert_eq!(history.get(99).unwrap().sequence, 105);

    // Test limit argument of get_nav_history
    let partial_history = client.get_nav_history(&pid, &10);
    assert_eq!(partial_history.len(), 10);
    assert_eq!(partial_history.get(0).unwrap().sequence, 96);
    assert_eq!(partial_history.get(9).unwrap().sequence, 105);
}

#[test]
fn test_auto_nav_snapshot_on_rebalance() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &80_0000000, &String::from_str(&env, "init"));
    client.deposit(&pid, &asset2, &20_0000000, &String::from_str(&env, "init"));

    env.ledger().with_mut(|li| {
        li.sequence_number = 10;
        li.timestamp = REBALANCE_COOLDOWN_SECONDS + 1;
    });

    client.execute_rebalance(&pid, &Map::new(&env));

    let history = client.get_nav_history(&pid, &10);
    assert_eq!(history.len(), 1);
    let snapshot = history.get(0).unwrap();
    assert_eq!(snapshot.sequence, 10);
    assert_eq!(snapshot.timestamp, REBALANCE_COOLDOWN_SECONDS + 1);
    assert_eq!(snapshot.usd_nav, 100_000000000);
}

#[test]
fn test_fee_transfer_to_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Configure fee: 50 bps (0.5%)
    let fee_config = FeeConfig {
        platform_name: String::from_str(&env, "Test Platform"),
        fee_bps: 50,
        fee_recipient: fee_recipient.clone(),
        enabled: true,
    };
    client.set_fee_config(&fee_config);

    // Fee config changes are timelocked: apply the queued config before
    // creating the portfolio so the ledger-timestamp drift guard stays within
    // bounds for the subsequent rebalance.
    env.ledger().with_mut(|li| {
        li.timestamp = TIMELOCK_DELAY_SECONDS + 1;
    });
    client.execute_fee_config();

    // Create portfolio with 2 assets (real tokens so transfers succeed)
    let mut allocations = Map::new(&env);
    let asset1 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    allocations.set(asset1.clone(), 5000); // 50%
    allocations.set(asset2.clone(), 5000); // 50%
    
    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    let pid = client.create_portfolio(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );
    
    // Deposit initial balances
    client.deposit(&pid, &asset1, &120_0000000, &String::from_str(&env, "init"));
    client.deposit(&pid, &asset2, &80_0000000, &String::from_str(&env, "init"));
    
    // Advance time past cooldown
    env.ledger().with_mut(|li| {
        li.timestamp += REBALANCE_COOLDOWN_SECONDS + 1;
    });
    
    // Execute rebalance; an empty `actual_balances` map skips the
    // execution-slippage verification (covered by the slippage-guard tests).
    client.execute_rebalance(&pid, &Map::new(&env));
    
    // Verify fee_collected event was emitted
    let events = all_events(&env);
    let fee_events: std::vec::Vec<_> = events
        .iter()
        .filter(|e| {
            if let Some(topic) = e.1.first() {
                match Symbol::try_from_val(&env, &topic) {
                    Ok(sym) => sym == Symbol::new(&env, "fee_collected"),
                    Err(_) => false,
                }
            } else {
                false
            }
        })
        .collect();

    assert!(!fee_events.is_empty(), "fee_collected event should be emitted");

    if let Some(event) = fee_events.first() {
        let data: (i128, Address, u64) = event.2.into_val(&env);
        assert_eq!(data.1, fee_recipient, "fee should be sent to configured recipient");
        assert!(data.0 > 0, "fee amount should be positive");
    }
}

#[test]
fn test_circuit_breaker_persists_pause_reason() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Create a portfolio
    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    
    // Verify initial pause reason is None
    let initial_reason = client.get_contract_pause_reason();
    assert_eq!(initial_reason, PauseReason::None);
    
    // Simulate circuit breaker trip by calling check_volatility with extreme price deviation
    // This would normally be called internally, but we're testing the persistence logic
    let config = CircuitBreakerConfig {
        spike_threshold_bps: 100, // 1% threshold
        window_seconds: 3600,
    };
    
    let mut current_prices = Map::new(&env);
    // Price has spiked 10% (1000 bps) which exceeds the 1% threshold
    current_prices.set(asset.clone(), 110_00000000000000i128);
    
    let reflector_client = ReflectorClient::new(&env, &reflector_id);
    let result = env.as_contract(&contract_id, || {
        crate::circuit_breaker::check_volatility(&env, &config, &reflector_client, &current_prices)
    });
    
    // Should return EmergencyStop error
    assert_eq!(result, Err(Error::EmergencyStop));

    // Verify circuit_breaker_tripped event was emitted. Note: this must be
    // checked before the client call below, because each subsequent client
    // invocation rolls the host event buffer back to its pre-call state.
    assert!(
        has_host_event(&env, "circuit_breaker_tripped"),
        "circuit_breaker_tripped event should be emitted"
    );

    // Verify pause reason was persisted as VolatilityCircuitBreaker
    let pause_reason = client.get_contract_pause_reason();
    assert_eq!(pause_reason, PauseReason::VolatilityCircuitBreaker);
}

#[test]
fn test_circuit_breaker_boundary_at_threshold_does_not_trip() {
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

    // MockReflector.twap() always returns 100_00000000000000 as the "price history".
    // A move of exactly 500 bps lands ON the threshold; the check is strictly '>',
    // so this must NOT trip.
    let config = CircuitBreakerConfig {
        spike_threshold_bps: 500,
        window_seconds: 3600,
    };
    let mut current_prices = Map::new(&env);
    current_prices.set(asset.clone(), 105_00000000000000i128); // exactly +500 bps


    let reflector_client = ReflectorClient::new(&env, &reflector_id);
    let result = env.as_contract(&contract_id, || {
        crate::circuit_breaker::check_volatility(&env, &config, &reflector_client, &current_prices)
    });
    assert_eq!(
        result,
        Ok(()),
        "deviation exactly at the spike threshold must not trip the circuit breaker"
    );
    assert_eq!(
        client.get_contract_pause_reason(),
        PauseReason::None,
        "pause reason must stay None when the breaker did not trip"
    );

    // Implementation asks us to also attempt a rebalance at this boundary.
    let _ = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(
        client.get_contract_pause_reason(),
        PauseReason::None,
        "a rebalance attempt must not itself change the pause reason at this boundary"
    );
}

#[test]
fn test_circuit_breaker_boundary_just_above_threshold_trips_with_exact_reason() {
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

    let config = CircuitBreakerConfig {
        spike_threshold_bps: 500,
        window_seconds: 3600,
    };
    let mut current_prices = Map::new(&env);
    // One bps past the threshold — the smallest possible trip.
    current_prices.set(asset.clone(), 105_01000000000000i128); // exactly +501 bps

    let reflector_client = ReflectorClient::new(&env, &reflector_id);
    let result = env.as_contract(&contract_id, || {
        crate::circuit_breaker::check_volatility(&env, &config, &reflector_client, &current_prices)
    });

    assert_eq!(
        result,
        Err(Error::EmergencyStop),
        "a deviation one bps past the threshold must trip the circuit breaker"
    );

    // Verify circuit_breaker_tripped event was emitted. Note: this must be
    // checked before the client call below, because each subsequent client
    // invocation rolls the host event buffer back to its pre-call state.
    // `has_host_event` reads the raw host event log (including events from
    // failed calls), which `env.events().all()` drops.
    assert!(
        has_host_event(&env, "circuit_breaker_tripped"),
        "circuit_breaker_tripped event should be emitted"
    );

    let pause_reason = client.get_contract_pause_reason();
    assert_eq!(
        pause_reason,
        PauseReason::VolatilityCircuitBreaker,
        "trip must store VolatilityCircuitBreaker specifically, got {:?} instead",
        pause_reason
    );
    // Belt-and-suspenders: make sure a wrong-but-still-"paused" variant can't
    // slip past a looser assertion by accident.
    assert_ne!(pause_reason, PauseReason::AdminEmergency);
    assert_ne!(pause_reason, PauseReason::UserPaused);
    assert_ne!(pause_reason, PauseReason::CooldownActive);
    // check_volatility() now flips DataKey::EmergencyStop alongside
    // ContractPauseReason, so the trip actually blocks further calls —
    // not just records a reason nothing else checks.
    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(
        result,
        Err(Ok(Error::EmergencyStop)),
        "a circuit breaker trip must actually block execute_rebalance, not just record a reason"
    );
}

#[test]
fn test_per_portfolio_circuit_breaker_config() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Create two portfolios with the same asset
    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    
    let pid1 = create_portfolio_with_defaults(&env, &client, &user1, &allocations, 5, 50);
    let pid2 = create_portfolio_with_defaults(&env, &client, &user2, &allocations, 5, 50);
    
    // Configure portfolio 1 with a low threshold (1%)
    client.set_pf_circuit_breaker(&pid1, &100, &3600);
    
    // Configure portfolio 2 with a high threshold (10%)
    client.set_pf_circuit_breaker(&pid2, &1000, &3600);
    
    // Verify configs were set
    let portfolio1 = client.get_portfolio(&pid1);
    let portfolio2 = client.get_portfolio(&pid2);
    assert_eq!(portfolio1.circuit_breaker_config.spike_threshold_bps, 100);
    assert_eq!(portfolio1.circuit_breaker_config.window_seconds, 3600);
    assert_eq!(portfolio2.circuit_breaker_config.spike_threshold_bps, 1000);
    assert_eq!(portfolio2.circuit_breaker_config.window_seconds, 3600);
    
    // Test that portfolio 1 trips at 5% deviation but portfolio 2 does not
    let config1 = portfolio1.circuit_breaker_config;
    let config2 = portfolio2.circuit_breaker_config;
    
    let mut current_prices = Map::new(&env);
    // Price has spiked 5% (500 bps)
    current_prices.set(asset.clone(), 105_00000000000000i128);
    
    let reflector_client = ReflectorClient::new(&env, &reflector_id);
    
    // Portfolio 1 with 1% threshold should trip
    let result1 = env.as_contract(&contract_id, || {
        crate::circuit_breaker::check_volatility(&env, &config1, &reflector_client, &current_prices)
    });
    assert_eq!(result1, Err(Error::EmergencyStop));
    
    // Portfolio 2 with 10% threshold should not trip
    let result2 = env.as_contract(&contract_id, || {
        crate::circuit_breaker::check_volatility(&env, &config2, &reflector_client, &current_prices)
    });
    assert_eq!(result2, Ok(()));
    
    // Reset pause reason for next test
    client.set_emergency_stop(&false);
    
    // Test that portfolio 2 trips at 15% deviation
    let mut high_prices = Map::new(&env);
    // Price has spiked 15% (1500 bps)
    high_prices.set(asset.clone(), 115_00000000000000i128);
    
    let result2_high = env.as_contract(&contract_id, || {
        crate::circuit_breaker::check_volatility(&env, &config2, &reflector_client, &high_prices)
    });
    assert_eq!(result2_high, Err(Error::EmergencyStop));
}

#[test]
fn test_default_circuit_breaker_config() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Create a portfolio without setting custom config
    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    
    // Verify default config is used
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.circuit_breaker_config.spike_threshold_bps, DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS);
    assert_eq!(portfolio.circuit_breaker_config.window_seconds, DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS);
}

#[test]
fn test_global_max_slippage_cap_aggregate_breach() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Create a portfolio with 3 assets
    let mut allocations = Map::new(&env);
    let asset1 = create_token_and_mint(&env, &admin, &user, 100_000_000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 100_000_000);
    let asset3 = create_token_and_mint(&env, &admin, &user, 100_000_000);
    allocations.set(asset1.clone(), 3334);
    allocations.set(asset2.clone(), 3333);
    allocations.set(asset3.clone(), 3333);
    
    // Set per-asset slippage tolerance to 2% (200 bps)
    // Set global max slippage to 3% (300 bps)
    let pid = client.create_portfolio(
        &user,
        &allocations,
        &allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS),
        &5,
        &200, // 2% per-asset tolerance
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );
    
    // Set global max slippage to 3% (300 bps)
    client.set_global_max_slippage(&pid, &300);

    // Keep the contract-level per-asset guard (default 100 bps) from tripping
    // before the aggregate global cap is evaluated, so this test exercises the
    // global cap specifically.
    client.set_asset_slippage(&asset1, &200);
    client.set_asset_slippage(&asset2, &200);
    client.set_asset_slippage(&asset3, &200);
    
    // Deposit initial balances
    client.deposit(&pid, &asset1, &100_000_000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &100_000_000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset3, &100_000_000, &String::from_str(&env, ""));
    env.ledger().with_mut(|li| {
        li.timestamp += REBALANCE_COOLDOWN_SECONDS + 1;
    });
    
    // Simulate actual balances with small slippage on each leg (1.5% each)
    // Each leg is under the 2% per-asset limit, but total (4.5%) exceeds the 3% global cap
    let mut actual_balances = Map::new(&env);
    // Expected: 100M each, actual: 98.5M each (1.5% slippage per leg)
    actual_balances.set(asset1.clone(), 98_500_000);
    actual_balances.set(asset2.clone(), 98_500_000);
    actual_balances.set(asset3.clone(), 98_500_000);
    
    let result = client.try_execute_rebalance(&pid, &actual_balances);
    // Should fail due to global slippage cap (4.5% total > 3% cap)
    assert_eq!(result, Err(Ok(Error::SlippageExceeded)));
    
    // Now test with lower slippage that stays under global cap
    let mut low_slippage_balances = Map::new(&env);
    // Expected: 100M each, actual: 99M each (1% slippage per leg, 3% total)
    low_slippage_balances.set(asset1.clone(), 99_000_000);
    low_slippage_balances.set(asset2.clone(), 99_000_000);
    low_slippage_balances.set(asset3.clone(), 99_000_000);
    
    let result_low = client.try_execute_rebalance(&pid, &low_slippage_balances);
    assert_eq!(result_low, Err(Ok(Error::RebalanceNotNeeded)));
}

#[test]
fn test_close_portfolio_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Create a portfolio with 2 assets
    let mut allocations = Map::new(&env);
    let asset1 = create_token_and_mint(&env, &admin, &user, 100_000_000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 50_000_000);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    
    // Deposit assets
    client.deposit(&pid, &asset1, &100_000_000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &50_000_000, &String::from_str(&env, ""));
    
    // Verify portfolio exists
    let portfolio_before = client.get_portfolio(&pid);
    assert_eq!(portfolio_before.current_balances.get(asset1.clone()).unwrap(), 100_000_000);
    assert_eq!(portfolio_before.current_balances.get(asset2.clone()).unwrap(), 50_000_000);
    
    // Close portfolio
    client.close_portfolio(&pid);
    
    // Verify portfolio_closed event was emitted. Note: this must be checked
    // BEFORE the (expected-to-fail) try_get_portfolio below, because a failed
    // invocation rolls the host event buffer back to its pre-call state.
    let events = all_events(&env);
    let close_events: std::vec::Vec<_> = events
        .iter()
        .filter(|e| {
            if let Some(topics) = e.1.first() {
                Symbol::try_from_val(&env, &topics).ok() == Some(Symbol::new(&env, "portfolio_closed"))
            } else {
                false
            }
        })
        .collect();
    
    assert!(!close_events.is_empty(), "portfolio_closed event should be emitted");

    // Verify portfolio no longer exists
    let result = client.try_get_portfolio(&pid);
    assert!(result.is_err(), "portfolio should no longer exist");
}

#[test]
fn test_close_portfolio_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let attacker = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Create a portfolio
    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 10000);
    
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    
    // Try to close portfolio as unauthorized user
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "close_portfolio",
            args: vec![&env, pid.into_val(&env)],
            sub_invokes: &[],
        },
    }]);
    
    let result = client.try_close_portfolio(&pid);
    assert!(result.is_err(), "unauthorized close should fail");
    
    // Verify portfolio still exists
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.user, user);
}

#[test]
fn test_timelock_fee_config_early_execution_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Queue a fee config change
    let new_config = FeeConfig {
        platform_name: String::from_str(&env, "TestPlatform"),
        fee_bps: 25,
        fee_recipient: admin.clone(),
        enabled: true,
    };
    client.set_fee_config(&new_config);
    
    // Try to execute immediately (should fail due to timelock)
    let result = client.try_execute_fee_config();
    assert_eq!(result, Err(Ok(Error::TimelockNotElapsed)));
    
    // Verify original config is still in place
    let current_config = client.get_fee_config();
    assert_eq!(current_config.fee_bps, 0);
    assert!(!current_config.enabled);
}

#[test]
fn test_timelock_fee_config_post_delay_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Queue a fee config change
    let new_config = FeeConfig {
        platform_name: String::from_str(&env, "TestPlatform"),
        fee_bps: 25,
        fee_recipient: admin.clone(),
        enabled: true,
    };
    client.set_fee_config(&new_config);
    
    // Advance ledger time past the timelock delay
    env.ledger().with_mut(|li| {
        li.timestamp = TIMELOCK_DELAY_SECONDS + 1;
    });
    
    // Execute after delay (should succeed)
    client.execute_fee_config();
    
    // Verify new config is applied
    let current_config = client.get_fee_config();
    assert_eq!(current_config.fee_bps, 25);
    assert!(current_config.enabled);
}

#[test]
fn test_timelock_upgrade_early_execution_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Queue an upgrade
    let new_wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    client.queue_upgrade(&new_wasm_hash);
    
    // Try to execute immediately (should fail due to timelock)
    let result = client.try_execute_upgrade();
    assert_eq!(result, Err(Ok(Error::TimelockNotElapsed)));
}

#[test]
fn test_timelock_upgrade_post_delay_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    
    client.initialize(&admin, &reflector_id);
    
    // Queue an upgrade to a wasm that actually exists in the ledger so the
    // host's `update_current_contract_wasm` finds it during execution.
    // In test mode the host permits uploading a zero-byte wasm (it is never
    // instantiated), which is all we need to exercise the timelock logic.
    let new_wasm_hash = env.deployer().upload_contract_wasm(&[0u8; 0] as &[u8]);
    client.queue_upgrade(&new_wasm_hash);

    // Verify upgrade_queued event was emitted. Note: this must be checked
    // BEFORE execute_upgrade below, because each subsequent client
    // invocation rolls the host event buffer back to its pre-call state.
    let events_after_queue = all_events(&env);
    let queue_events: std::vec::Vec<_> = events_after_queue
        .iter()
        .filter(|e| {
            if let Some(topics) = e.1.first() {
                Symbol::try_from_val(&env, &topics).ok() == Some(Symbol::new(&env, "upgrade_queued"))
            } else {
                false
            }
        })
        .collect();
    assert!(!queue_events.is_empty(), "upgrade_queued event should be emitted");
    
    // Advance ledger time past the timelock delay
    env.ledger().with_mut(|li| {
        li.timestamp = TIMELOCK_DELAY_SECONDS + 1;
    });
    
    // Execute after delay (should succeed)
    client.execute_upgrade();
    
    // Verify upgraded event was emitted
    let events_after_upgrade = all_events(&env);
    let upgrade_events: std::vec::Vec<_> = events_after_upgrade
        .iter()
        .filter(|e| {
            // execute_upgrade publishes topics ("portfolio", "upgraded") as
            // string topics, so compare against a String, not a Symbol.
            e.1.iter().any(|t| {
                String::try_from_val(&env, &t).ok() == Some(String::from_str(&env, "upgraded"))
            })
        })
        .collect();
    assert!(!upgrade_events.is_empty(), "upgraded event should be emitted");
}

// ── Issue #1378: schema-version-aware migrate_storage() in upgrade() ────

#[test]
fn test_fresh_initialize_starts_at_current_schema_version() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    assert_eq!(client.storage_schema_version(), CURRENT_STORAGE_SCHEMA_VERSION);
}

#[test]
fn test_execute_upgrade_migrates_legacy_portfolio_storage() {
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

    // Simulate a contract that predates both the strategy-aware portfolio
    // schema and storage-schema versioning: downgrade the just-created
    // PortfolioV2 entry to the old LegacyPortfolio shape under the old key,
    // and reset SchemaVersion to "never migrated".
    env.as_contract(&contract_id, || {
        let current: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::PortfolioV2(pid))
            .unwrap();
        let legacy = LegacyPortfolio {
            user: current.user,
            target_allocations: current.target_allocations,
            current_balances: current.current_balances,
            asset_decimals: current.asset_decimals,
            rebalance_threshold: current.rebalance_threshold,
            slippage_tolerance: current.slippage_tolerance,
            slippage_policy_version: current.slippage_policy_version,
            last_rebalance: current.last_rebalance,
            total_value: current.total_value,
            is_active: current.is_active,
            pause_reason: current.pause_reason,
            circuit_breaker_config: current.circuit_breaker_config,
            global_max_slippage_bps: current.global_max_slippage_bps,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(pid), &legacy);
        env.storage().persistent().remove(&DataKey::PortfolioV2(pid));
        env.storage().instance().remove(&DataKey::SchemaVersion);
    });

    assert_eq!(client.storage_schema_version(), 0);

    // Queue + execute an upgrade -- migrate_storage() should run as part of
    // execute_upgrade, before any new functionality is exposed.
    let new_wasm_hash = env.deployer().upload_contract_wasm(&[0u8; 0] as &[u8]);
    client.queue_upgrade(&new_wasm_hash);
    env.ledger().with_mut(|li| {
        li.timestamp = TIMELOCK_DELAY_SECONDS + 1;
    });
    client.execute_upgrade();

    // schema_version is incremented and persisted post-migration.
    assert_eq!(client.storage_schema_version(), CURRENT_STORAGE_SCHEMA_VERSION);

    // Old-format data was migrated and is readable post-upgrade -- checked
    // directly against storage (not via a getter that itself lazily
    // migrates on read) to prove migrate_storage() did the work eagerly.
    env.as_contract(&contract_id, || {
        assert!(
            !env.storage().persistent().has(&DataKey::Portfolio(pid)),
            "legacy key should have been removed by migration"
        );
        let migrated: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::PortfolioV2(pid))
            .expect("PortfolioV2 should exist after migration");
        assert_eq!(migrated.user, user);
        assert_eq!(migrated.strategy, StrategyType::Threshold);
    });
}

#[test]
fn test_benchmark_nav_operations() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = create_token_and_mint(&env, &admin, &user, 100_0000000);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    client.deposit(&pid, &asset, &100_0000000, &String::from_str(&env, "init"));

    // Measure snapshot_nav with empty history
    env.budget().reset_unlimited();
    env.budget().reset_tracker();
    let _ = client.snapshot_nav(&pid);
    let cpu_empty = env.budget().cpu_instruction_cost();
    let mem_empty = env.budget().memory_bytes_cost();

    std::println!("BENCHMARK_NAV_EMPTY_HISTORY_CPU: {}", cpu_empty);
    std::println!("BENCHMARK_NAV_EMPTY_HISTORY_MEM: {}", mem_empty);

    // Fill history to 99 elements
    for i in 0..98 {
        env.ledger().with_mut(|li| {
            li.sequence_number = i + 10;
            li.timestamp = i as u64 + 10000;
        });
        let _ = client.snapshot_nav(&pid);
    }

    // Measure snapshot_nav with full history (where eviction / slice happens)
    env.ledger().with_mut(|li| {
        li.sequence_number = 500;
        li.timestamp = 50000;
    });
    env.budget().reset_unlimited();
    env.budget().reset_tracker();
    let _ = client.snapshot_nav(&pid);
    let cpu_full = env.budget().cpu_instruction_cost();
    let mem_full = env.budget().memory_bytes_cost();

    std::println!("BENCHMARK_NAV_FULL_HISTORY_CPU: {}", cpu_full);
    std::println!("BENCHMARK_NAV_FULL_HISTORY_MEM: {}", mem_full);
}

mod circuit_breaker_test {
    use super::*;
    use crate::circuit_breaker::check_volatility;
    use crate::reflector::{Asset, PriceData, ReflectorClient};
    use soroban_sdk::{contract, contractimpl, Env, Map, Symbol, Vec};

    #[contract]
    pub struct MockReflectorForCircuitBreaker;

    #[contractimpl]
    impl MockReflectorForCircuitBreaker {
        pub fn base(_env: Env) -> Asset {
            Asset::Other(Symbol::new(&_env, "USD"))
        }
        pub fn assets(_env: Env) -> Vec<Asset> {
            Vec::new(&_env)
        }
        pub fn decimals(_env: Env) -> u32 {
            14
        }
        pub fn lastprice(_env: Env, _asset: Asset) -> Option<PriceData> {
            None
        }
        pub fn twap(_env: Env, _asset: Asset, records: u32) -> Option<i128> {
            if records == 0 {
                None
            } else {
                Some(100_00000000000000i128)
            }
        }
    }

    #[test]
    fn test_check_volatility_zero_records_returns_error() {
        let env = Env::default();
        env.mock_all_auths();

        let reflector_id = env.register_contract(None, MockReflectorForCircuitBreaker);
        let client = ReflectorClient::new(&env, &reflector_id);

        let mut current_prices = Map::new(&env);
        let asset = Address::generate(&env);
        current_prices.set(asset.clone(), 100_00000000000000i128);

        let config = crate::types::CircuitBreakerConfig {
            window_seconds: 30,
            spike_threshold_bps: 100,
        };

        let result = check_volatility(&env, &config, &client, &current_prices);
        assert_eq!(result, Err(Error::InvalidThreshold));
    }

    #[test]
    fn test_check_volatility_valid_records_works() {
        let env = Env::default();
        env.mock_all_auths();

        let reflector_id = env.register_contract(None, MockReflectorForCircuitBreaker);
        let client = ReflectorClient::new(&env, &reflector_id);

        let mut current_prices = Map::new(&env);
        let asset = Address::generate(&env);
        // 1% deviation (100 bps) is at the 100 bps threshold, not above it,
        // so `check_volatility` accepts the valid record window.
        current_prices.set(asset.clone(), 101_00000000000000i128);

        let config = crate::types::CircuitBreakerConfig {
            window_seconds: 300,
            spike_threshold_bps: 100,
        };

        let result = check_volatility(&env, &config, &client, &current_prices);
        assert!(result.is_ok());
    }

    #[test]
    fn test_check_volatility_boundary_59_seconds_returns_error() {
        let env = Env::default();
        env.mock_all_auths();

        let reflector_id = env.register_contract(None, MockReflectorForCircuitBreaker);
        let client = ReflectorClient::new(&env, &reflector_id);

        let mut current_prices = Map::new(&env);
        let asset = Address::generate(&env);
        current_prices.set(asset.clone(), 100_00000000000000i128);

        let config = crate::types::CircuitBreakerConfig {
            window_seconds: 59,
            spike_threshold_bps: 100,
        };

        let result = check_volatility(&env, &config, &client, &current_prices);
        assert_eq!(result, Err(Error::InvalidThreshold));
    }

    #[test]
    fn test_check_volatility_boundary_60_seconds_works() {
        let env = Env::default();
        env.mock_all_auths();

        let reflector_id = env.register_contract(None, MockReflectorForCircuitBreaker);
        let client = ReflectorClient::new(&env, &reflector_id);

        let mut current_prices = Map::new(&env);
        let asset = Address::generate(&env);
        current_prices.set(asset.clone(), 100_00000000000000i128);

        let config = crate::types::CircuitBreakerConfig {
            window_seconds: 60,
            spike_threshold_bps: 100,
        };

        let result = check_volatility(&env, &config, &client, &current_prices);
        assert!(result.is_ok());
    }
}

mod reflector_volatile {
    use crate::reflector::{Asset, PriceData};
    use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};

    #[contract]
    pub struct VolatileReflector;

    #[contractimpl]
    impl VolatileReflector {
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
            Some(PriceData {
                price: 150_00000000000000i128,
                timestamp: env.ledger().timestamp(),
            })
        }
        pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
            Some(100_00000000000000i128)
        }
    }
}


#[test]
fn test_rebalance_rejected_during_high_volatility() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_volatile::VolatileReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let cb_config = CircuitBreakerConfig {
        spike_threshold_bps: 100,
        window_seconds: 3600,
    };
    client.set_circuit_breaker_config(&cb_config);

    let mut allocations = Map::new(&env);
    let asset = create_token_and_mint(&env, &admin, &user, 1000);
    allocations.set(asset.clone(), 10000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset, &1000, &String::from_str(&env, ""));

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(result, Err(Ok(Error::EmergencyStop)));
}

#[test]
fn test_update_allocations_success() {
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

    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let mut new_allocations = Map::new(&env);
    new_allocations.set(asset1.clone(), 7000);
    new_allocations.set(asset2.clone(), 3000);
    client.update_allocations(&pid, &new_allocations);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.target_allocations.get(asset1).unwrap(), 7000);
    assert_eq!(portfolio.target_allocations.get(asset2).unwrap(), 3000);
}

#[test]
fn test_update_allocations_invalid_sum() {
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

    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let mut bad_allocations = Map::new(&env);
    bad_allocations.set(asset1.clone(), 6000);
    bad_allocations.set(asset2.clone(), 3000);
    let result = client.try_update_allocations(&pid, &bad_allocations);
    assert_eq!(result, Err(Ok(Error::InvalidAllocation)));
}

#[test]
fn test_update_allocations_unknown_asset() {
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

    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let unknown_asset = Address::generate(&env);
    let mut bad_allocations = Map::new(&env);
    bad_allocations.set(asset1.clone(), 5000);
    bad_allocations.set(unknown_asset, 5000);
    let result = client.try_update_allocations(&pid, &bad_allocations);
    assert_eq!(result, Err(Ok(Error::AssetNotSupported)));
}

#[test]
fn test_update_allocations_then_rebalance() {
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

    let asset1 = create_token_and_mint(&env, &admin, &user, 200_000_000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200_000_000);
    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &100_000_000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &100_000_000, &String::from_str(&env, ""));

    let mut new_allocations = Map::new(&env);
    new_allocations.set(asset1.clone(), 8000);
    new_allocations.set(asset2.clone(), 2000);
    client.update_allocations(&pid, &new_allocations);

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    client.execute_rebalance(&pid, &Map::new(&env));

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 15000);
    assert!(portfolio.current_balances.get(asset1).unwrap() > portfolio.current_balances.get(asset2).unwrap());
}

#[test]
fn test_create_portfolio_with_strategy_defaults_to_threshold() {
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
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.strategy, StrategyType::Threshold);
    assert_eq!(
        portfolio.strategy_config,
        StrategyConfig::default()
    );
}

#[test]
fn test_create_portfolio_with_strategy_periodic() {
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
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);

    let strategy_config = StrategyConfig {
        interval_seconds: 86400, // 1 day
        volatility_threshold_bps: 1000,
        min_interval_seconds: 86400,
    };

    let pid = client.create_portfolio_with_strategy(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
        &StrategyType::Periodic,
        &strategy_config,
    );

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.strategy, StrategyType::Periodic);
    assert_eq!(portfolio.strategy_config.interval_seconds, 86400);
}

#[test]
fn test_create_portfolio_with_strategy_volatility() {
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
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);

    let strategy_config = StrategyConfig {
        interval_seconds: 604800,
        volatility_threshold_bps: 2000, // 20%
        min_interval_seconds: 86400,
    };

    let pid = client.create_portfolio_with_strategy(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
        &StrategyType::Volatility,
        &strategy_config,
    );

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.strategy, StrategyType::Volatility);
    assert_eq!(portfolio.strategy_config.volatility_threshold_bps, 2000);
}

#[test]
fn test_create_portfolio_with_strategy_custom() {
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
    let asset = Address::generate(&env);
    allocations.set(asset, 10000);
    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);

    let strategy_config = StrategyConfig {
        interval_seconds: 3600,
        volatility_threshold_bps: 500,
        min_interval_seconds: 43200, // 12 hours
    };

    let pid = client.create_portfolio_with_strategy(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
        &StrategyType::Custom,
        &strategy_config,
    );

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.strategy, StrategyType::Custom);
    assert_eq!(portfolio.strategy_config.min_interval_seconds, 43200);
}

// ── Cross-oracle validation tests ────────────────────────────────────────────

mod coingecko_deviating {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockCoinGecko;

    #[contractimpl]
    impl MockCoinGecko {
        pub fn price(_env: Env, _asset: Address) -> Option<i128> {
            Some(90_00000000000000i128)
        }
    }
}

mod coingecko_within_threshold {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockCoinGeckoWithin;

    #[contractimpl]
    impl MockCoinGeckoWithin {
        pub fn price(_env: Env, _asset: Address) -> Option<i128> {
            // 1% deviation — within the default 3% threshold
            Some(99_00000000000000i128)
        }
    }
}

#[test]
fn test_oracle_deviation_uses_conservative_price() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let coingecko_id = env.register_contract(None, coingecko_deviating::MockCoinGecko);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);
    client.set_coingecko_address(&coingecko_id);

    let mut allocations = Map::new(&env);
    let asset1 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &80_0000000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &20_0000000, &String::from_str(&env, ""));

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    client.execute_rebalance(&pid, &Map::new(&env));

    let events = all_events(&env);
    let mut found_warning = false;
    for event in events.iter() {
        let (_contract_id, topics, _data) = event;
        if topics.len() >= 1 {
            if let Ok(sym) = Symbol::try_from_val(&env, &topics.get(0).unwrap()) {
                if sym == soroban_sdk::Symbol::new(&env, "oracle_dev_warn") {
                    found_warning = true;
                    break;
                }
            }
        }
    }
    assert!(
        found_warning,
        "OracleDeviationWarning event must be emitted on price deviation"
    );

    let portfolio = client.get_portfolio(&pid);
    let value_without_cg = (100_0000000i128 * 100_00000000000000i128) / 10i128.pow(14);
    let value_with_cg = (100_0000000i128 * 90_00000000000000i128) / 10i128.pow(14);
    assert_eq!(
        portfolio.total_value, value_with_cg,
        "conservative price should be used when deviation exceeds threshold"
    );
    assert_ne!(
        portfolio.total_value, value_without_cg,
        "should NOT use the higher reflector price"
    );

}

#[test]
fn test_oracle_deviation_within_threshold_no_warning() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let coingecko_id = env.register_contract(None, coingecko_within_threshold::MockCoinGeckoWithin);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);
    client.set_coingecko_address(&coingecko_id);

    let mut allocations = Map::new(&env);
    let asset1 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &80_0000000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &20_0000000, &String::from_str(&env, ""));

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    client.execute_rebalance(&pid, &Map::new(&env));

    let events = all_events(&env);
    let mut found_warning = false;
    for event in events.iter() {
        let (_contract_id, topics, _data) = event;
        if topics.len() >= 1 {
            if let Ok(sym) = Symbol::try_from_val(&env, &topics.get(0).unwrap()) {
                if sym == soroban_sdk::Symbol::new(&env, "oracle_dev_warn") {
                    found_warning = true;
                    break;
                }
            }
        }
    }
    assert!(
        !found_warning,
        "no OracleDeviationWarning when deviation is within threshold"
    );

    let portfolio = client.get_portfolio(&pid);
    let expected_value =
        (100_0000000i128 * 100_00000000000000i128) / 10i128.pow(14);
    assert_eq!(portfolio.total_value, expected_value);
}

#[test]
fn test_oracle_deviation_no_coingecko_configured() {
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
    let asset1 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    let asset2 = create_token_and_mint(&env, &admin, &user, 200_0000000);
    allocations.set(asset1.clone(), 5000);
    allocations.set(asset2.clone(), 5000);
    let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);

    client.deposit(&pid, &asset1, &80_0000000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset2, &20_0000000, &String::from_str(&env, ""));

    env.ledger().with_mut(|li| {
        li.timestamp = 15000;
    });

    client.execute_rebalance(&pid, &Map::new(&env));

    let events = all_events(&env);
    let mut found_warning = false;
    for event in events.iter() {
        let (_contract_id, topics, _data) = event;
        if topics.len() >= 1 {
            if let Ok(sym) = Symbol::try_from_val(&env, &topics.get(0).unwrap()) {
                if sym == soroban_sdk::Symbol::new(&env, "oracle_dev_warn") {
                    found_warning = true;
                    break;
                }
            }
        }
    }
    assert!(!found_warning, "no warning when no CoinGecko configured");

    let portfolio = client.get_portfolio(&pid);
    let expected_value =
        (100_0000000i128 * 100_00000000000000i128) / 10i128.pow(14);
    assert_eq!(portfolio.total_value, expected_value);
}


mod slippage_test {
    use super::*;

    fn init_contract(env: &Env) -> (Address, PortfolioRebalancerClient, Address, Address) {
        let contract_id = env.register_contract(None, PortfolioRebalancer);
        let client = PortfolioRebalancerClient::new(env, &contract_id);
        let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
        let admin = Address::generate(env);
        let user = Address::generate(env);
        client.initialize(&admin, &reflector_id);
        (contract_id, client, admin, user)
    }

    fn advance_past_cooldown(env: &Env) {
        env.ledger().with_mut(|li| {
            li.timestamp += REBALANCE_COOLDOWN_SECONDS + 1;
        });
    }

    /// `true` when a `("slippage_guard", "triggered")` event for `asset` was
    /// emitted, carrying the expected and actual execution prices.
    fn guard_triggered_payload(
        env: &Env,
        asset: &Address,
    ) -> Option<(Address, i128, i128, u32, u32)> {
        // `env.events().all()` drops events emitted during failed calls
        // (e.g. a reverted rebalance), so read the raw host event log which
        // retains those with `failed_call` set.
        let host_events = env.host().get_events().unwrap().0;
        for host_event in host_events.iter() {
            if let soroban_sdk::xdr::ContractEventBody::V0(v0) = &host_event.event.body {
                let mut topics: Vec<Val> = Vec::new(env);
                for scval in v0.topics.iter() {
                    topics.push_back(Val::try_from_val(env, scval).unwrap());
                }
                if let Some(topic) = topics.first() {
                    if let Ok(sym) = Symbol::try_from_val(env, &topic) {
                        // Distinguish the `("slippage_guard", "triggered")` event
                        // from `("slippage_guard", "configured")` (2-tuple data)
                        // before decoding the 5-tuple payload.
                        if sym == Symbol::new(env, "slippage_guard")
                            && topics.len() == 2
                            && Symbol::try_from_val(env, &topics.get(1).unwrap())
                                == Ok(Symbol::new(env, "triggered"))
                        {
                            let data: (Address, i128, i128, u32, u32) =
                                Val::try_from_val(env, &v0.data).unwrap().into_val(env);
                            if data.0 == *asset {
                                return Some(data);
                            }
                        }
                    }
                }
            }
        }
        None
    }

    fn has_guard_triggered_event(env: &Env, asset: &Address) -> bool {
        guard_triggered_payload(env, asset).is_some()
    }

    #[test]
    fn test_set_and_get_asset_slippage() {
        let env = Env::default();
        env.mock_all_auths();
        let (_cid, client, _admin, _user) = init_contract(&env);
        let asset = Address::generate(&env);

        // Default limit is 1% (100 bps) when unset.
        assert_eq!(client.get_asset_slippage(&asset), DEFAULT_ASSET_SLIPPAGE_BPS);

        // Admin can configure a custom limit without redeployment.
        client.set_asset_slippage(&asset, &250);
        assert_eq!(client.get_asset_slippage(&asset), 250);

        // Maximum allowed limit (5% / 500 bps) is accepted.
        client.set_asset_slippage(&asset, &MAX_ASSET_SLIPPAGE_BPS);
        assert_eq!(client.get_asset_slippage(&asset), MAX_ASSET_SLIPPAGE_BPS);
    }

    #[test]
    fn test_set_asset_slippage_rejects_above_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (_cid, client, _admin, _user) = init_contract(&env);
        let asset = Address::generate(&env);

        let result = client.try_set_asset_slippage(&asset, &(MAX_ASSET_SLIPPAGE_BPS + 1));
        assert_eq!(result, Err(Ok(Error::InvalidSlippageLimit)));
        assert_eq!(client.get_asset_slippage(&asset), DEFAULT_ASSET_SLIPPAGE_BPS);
    }

    #[test]
    fn test_slippage_guard_accepts_no_deviation() {
        let env = Env::default();
        let (cid, _client, _admin, _user) = init_contract(&env);
        let asset = Address::generate(&env);

        let result = env.as_contract(&cid, || {
            crate::slippage::check_execution_slippage(&env, &asset, 100_0000000, 100_0000000)
        });
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_slippage_guard_triggers_on_price_deviation() {
        let env = Env::default();
        env.mock_all_auths();
        let (cid, _client, _admin, _user) = init_contract(&env);
        let asset = Address::generate(&env);

        // ~5% price deviation (500 bps) exceeds the 1% (100 bps) default limit.
        let result = env.as_contract(&cid, || {
            crate::slippage::check_execution_slippage(&env, &asset, 100_0000000, 95_0000000)
        });
        assert_eq!(result, Err(Error::SlippageExceeded));
        // Acceptance criterion: SlippageGuardTriggered carries expected vs actual
        // price (plus the limit and the measured deviation in bps).
        let payload = guard_triggered_payload(&env, &asset);
        assert_eq!(
            payload,
            Some((asset.clone(), 100_0000000, 95_0000000, DEFAULT_ASSET_SLIPPAGE_BPS, 500))
        );
    }

    #[test]
    fn test_slippage_guard_accepts_deviation_within_custom_limit() {
        let env = Env::default();
        env.mock_all_auths();
        let (cid, client, _admin, _user) = init_contract(&env);
        let asset = Address::generate(&env);

        client.set_asset_slippage(&asset, &500);
        // 5% deviation equals the configured 500 bps limit, so it is allowed
        // (the guard trips only when the deviation is strictly greater).
        let result = env.as_contract(&cid, || {
            crate::slippage::check_execution_slippage(&env, &asset, 100_0000000, 95_0000000)
        });
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_rebalance_reverts_over_contract_slippage_limit() {
        let env = Env::default();
        env.mock_all_auths();
        let (_cid, client, admin, user) = init_contract(&env);

        let mut allocations = Map::new(&env);
        let asset = create_token_and_mint(&env, &admin, &user, 100_0000000);
        allocations.set(asset.clone(), 10000);
        let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 500);

        client.deposit(&pid, &asset, &100_0000000, &String::from_str(&env, ""));
        advance_past_cooldown(&env);

        // 5% balance deviation -> 500 bps, over the 100 bps default contract limit.
        let mut actual_balances = Map::new(&env);
        actual_balances.set(asset.clone(), 95_0000000);
        let result = client.try_execute_rebalance(&pid, &actual_balances);
        assert_eq!(result, Err(Ok(Error::SlippageExceeded)));

        // SlippageGuardTriggered event emitted with expected vs actual price.
        assert!(
            has_guard_triggered_event(&env, &asset),
            "SlippageGuardTriggered event should be emitted"
        );
    }

    #[test]
    fn test_rebalance_slippage_limit_configurable_without_redeployment() {
        let env = Env::default();
        env.mock_all_auths();
        let (_cid, client, admin, user) = init_contract(&env);

        let mut allocations = Map::new(&env);
        let asset = create_token_and_mint(&env, &admin, &user, 100_0000000);
        allocations.set(asset.clone(), 10000);
        let pid = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 500);
        // Raise the portfolio-level global cap so it does not mask the
        // contract-level asset limit being tested (default global cap is 300 bps).
        client.set_global_max_slippage(&pid, &1000);

        client.deposit(&pid, &asset, &100_0000000, &String::from_str(&env, ""));
        advance_past_cooldown(&env);

        let mut actual_balances = Map::new(&env);
        actual_balances.set(asset.clone(), 95_0000000);

        // Default 1% contract limit -> 5% deviation reverts.
        assert_eq!(
            client.try_execute_rebalance(&pid, &actual_balances),
            Err(Ok(Error::SlippageExceeded))
        );

        // Admin raises the asset-class limit to 5% -> the same deviation now
        // passes the slippage guard. The portfolio has no drift (single asset
        // at target), so no candidate trades remain.
        client.set_asset_slippage(&asset, &MAX_ASSET_SLIPPAGE_BPS);
        assert_eq!(
            client.try_execute_rebalance(&pid, &actual_balances),
            Err(Ok(Error::RebalanceNotNeeded))
        );
    }
}

// ── Issue #967: on-chain portfolio templates ────────────────────────────

#[test]
fn test_create_and_get_template() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 6000);
    allocations.set(asset2.clone(), 4000);

    let name = String::from_str(&env, "Conservative");
    client.create_template(&name, &allocations);

    let stored = client.get_template(&name).unwrap();
    assert_eq!(stored.get(asset1).unwrap(), 6000);
    assert_eq!(stored.get(asset2).unwrap(), 4000);

    let names = client.list_templates();
    assert_eq!(names.len(), 1);
    assert_eq!(names.get(0).unwrap(), name);
}

#[test]
fn test_get_template_unknown_returns_none() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let name = String::from_str(&env, "DoesNotExist");
    assert_eq!(client.get_template(&name), None);
}

#[test]
#[should_panic]
fn test_create_template_non_admin_rejected() {
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

    let asset = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset, 10000);
    let name = String::from_str(&env, "Aggressive");

    client
        .mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_template",
                args: (&name, &allocations).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .create_template(&name, &allocations);
}

#[test]
fn test_create_template_invalid_allocation_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let asset = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset, 9000); // does not sum to 10000
    let name = String::from_str(&env, "Balanced");

    let result = client.try_create_template(&name, &allocations);
    assert_eq!(result, Err(Ok(Error::InvalidAllocation)));
}

#[test]
fn test_create_template_duplicate_name_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let asset = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset, 10000);
    let name = String::from_str(&env, "Balanced");

    client.create_template(&name, &allocations);
    let result = client.try_create_template(&name, &allocations);
    assert_eq!(result, Err(Ok(Error::TemplateAlreadyExists)));
}

#[test]
fn test_create_template_too_many_assets_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    // MAX_PORTFOLIO_ASSETS is 10; use 11 assets so the template could never
    // be turned into a portfolio via create_portfolio_from_template.
    let mut allocations = Map::new(&env);
    for i in 0..11u32 {
        let asset = Address::generate(&env);
        let pct = if i == 10 { 910 } else { 909 };
        allocations.set(asset, pct);
    }
    let name = String::from_str(&env, "TooBig");

    let result = client.try_create_template(&name, &allocations);
    assert_eq!(result, Err(Ok(Error::TooManyAssets)));
}

#[test]
fn test_update_template_too_many_assets_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let asset = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset, 10000);
    let name = String::from_str(&env, "Balanced");
    client.create_template(&name, &allocations);

    let mut oversized = Map::new(&env);
    for i in 0..11u32 {
        let a = Address::generate(&env);
        let pct = if i == 10 { 910 } else { 909 };
        oversized.set(a, pct);
    }

    let result = client.try_update_template(&name, &oversized);
    assert_eq!(result, Err(Ok(Error::TooManyAssets)));
}

#[test]
fn test_create_template_registry_limit_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    for i in 0..MAX_TEMPLATES {
        let asset = Address::generate(&env);
        let mut allocations = Map::new(&env);
        allocations.set(asset, 10000);
        let name = String::from_str(&env, &std::format!("Template{}", i));
        client.create_template(&name, &allocations);
    }
    assert_eq!(client.list_templates().len(), MAX_TEMPLATES);

    let asset = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset, 10000);
    let one_too_many = String::from_str(&env, "OneTooMany");

    let result = client.try_create_template(&one_too_many, &allocations);
    assert_eq!(result, Err(Ok(Error::TooManyTemplates)));
}

#[test]
fn test_update_template_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 10000);
    let name = String::from_str(&env, "Balanced");
    client.create_template(&name, &allocations);

    let mut updated = Map::new(&env);
    updated.set(asset1.clone(), 5000);
    updated.set(asset2.clone(), 5000);
    client.update_template(&name, &updated);

    let stored = client.get_template(&name).unwrap();
    assert_eq!(stored.get(asset1).unwrap(), 5000);
    assert_eq!(stored.get(asset2).unwrap(), 5000);

    // Registry should not gain a duplicate entry from the update.
    assert_eq!(client.list_templates().len(), 1);
}

#[test]
fn test_update_template_unknown_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let asset = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset, 10000);
    let name = String::from_str(&env, "Ghost");

    let result = client.try_update_template(&name, &allocations);
    assert_eq!(result, Err(Ok(Error::TemplateNotFound)));
}

#[test]
fn test_create_portfolio_from_template() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset1.clone(), 6000);
    allocations.set(asset2.clone(), 4000);
    let name = String::from_str(&env, "Conservative");
    client.create_template(&name, &allocations);

    let asset_decimals = allocation_decimals(&env, &allocations, DEFAULT_ASSET_DECIMALS);
    let portfolio_id = client.create_portfolio_from_template(
        &user,
        &name,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );

    assert!(portfolio_id > 0);
    let portfolio = client.get_portfolio(&portfolio_id);
    assert_eq!(portfolio.user, user);
    assert_eq!(portfolio.target_allocations.get(asset1).unwrap(), 6000);
    assert_eq!(portfolio.target_allocations.get(asset2).unwrap(), 4000);
}

#[test]
fn test_create_portfolio_from_unknown_template_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let asset = Address::generate(&env);
    let mut asset_decimals = Map::new(&env);
    asset_decimals.set(asset, DEFAULT_ASSET_DECIMALS);
    let name = String::from_str(&env, "Nonexistent");

    let result = client.try_create_portfolio_from_template(
        &user,
        &name,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );
    assert_eq!(result, Err(Ok(Error::TemplateNotFound)));
}

// ── Two-step admin transfer (propose / accept) ───────────────────────────

/// Register and initialize the contract with a known admin *without* leaning
/// on `env.mock_all_auths()`, so the admin-transfer tests below can mock auth
/// per-address and prove who is actually allowed to call what.
///
/// Returns `(contract_id, admin)`; callers build their own client so each test
/// keeps control of the auth entries it mocks.
fn init_with_scoped_auth(env: &Env) -> (Address, Address) {
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(env);

    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&admin, &reflector_id).into_val(env),
                sub_invokes: &[],
            },
        }])
        .initialize(&admin, &reflector_id);

    (contract_id, admin)
}

#[test]
fn test_two_step_admin_transfer_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    assert_eq!(client.get_pending_admin(), None, "no transfer in flight yet");

    // Step 1: propose. The incumbent is still the admin at this point.
    client.propose_admin(&new_admin);
    assert_eq!(client.get_pending_admin(), Some(new_admin.clone()));
    assert_eq!(
        client.get_admin(),
        admin,
        "proposing must not hand over admin rights on its own"
    );

    // Step 2: accept. Only now does the admin actually change.
    client.accept_admin();
    assert_eq!(client.get_admin(), new_admin);
    assert_eq!(
        client.get_pending_admin(),
        None,
        "pending nomination is cleared once accepted"
    );
}

#[test]
fn test_two_step_admin_transfer_emits_events_at_each_step() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    client.propose_admin(&new_admin);

    let proposed = all_events(&env)
        .into_iter()
        .rev()
        .find(|(_, topics, _)| match topics.first() {
            Some(topic) => match Symbol::try_from_val(&env, &topic) {
                Ok(sym) => sym == Symbol::new(&env, "admin_proposed"),
                Err(_) => false,
            },
            None => false,
        })
        .expect("propose_admin emits admin_proposed");
    assert_eq!(
        Address::try_from_val(&env, &proposed.1.get(1).unwrap()).unwrap(),
        admin,
        "admin_proposed is topic-indexed by the proposing admin"
    );
    let proposed_data: Address = proposed.2.into_val(&env);
    assert_eq!(proposed_data, new_admin);

    client.accept_admin();

    let transferred = all_events(&env)
        .into_iter()
        .rev()
        .find(|(_, topics, _)| match topics.first() {
            Some(topic) => match Symbol::try_from_val(&env, &topic) {
                Ok(sym) => sym == Symbol::new(&env, "admin_transferred"),
                Err(_) => false,
            },
            None => false,
        })
        .expect("accept_admin emits admin_transferred");
    assert_eq!(
        Address::try_from_val(&env, &transferred.1.get(1).unwrap()).unwrap(),
        admin,
        "admin_transferred is topic-indexed by the outgoing admin"
    );
    let transferred_data: Address = transferred.2.into_val(&env);
    assert_eq!(transferred_data, new_admin);
}

#[test]
fn test_propose_admin_overwrites_pending_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let first_candidate = Address::generate(&env);
    let second_candidate = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    client.propose_admin(&first_candidate);
    client.propose_admin(&second_candidate);

    assert_eq!(
        client.get_pending_admin(),
        Some(second_candidate.clone()),
        "the newest proposal replaces the one in flight"
    );

    // The superseded candidate can no longer claim the role; the live one can.
    client.accept_admin();
    assert_eq!(client.get_admin(), second_candidate);
}

#[test]
#[should_panic]
fn test_superseded_candidate_cannot_accept_admin() {
    let env = Env::default();

    let (contract_id, admin) = init_with_scoped_auth(&env);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let first_candidate = Address::generate(&env);
    let second_candidate = Address::generate(&env);

    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_admin",
                args: (&first_candidate,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .propose_admin(&first_candidate);

    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_admin",
                args: (&second_candidate,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .propose_admin(&second_candidate);

    // `accept_admin` requires auth from the *stored* pending admin, which the
    // second proposal overwrote, so the superseded candidate cannot finalize.
    client
        .mock_auths(&[MockAuth {
            address: &first_candidate,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "accept_admin",
                args: vec![&env],
                sub_invokes: &[],
            },
        }])
        .accept_admin();
}

#[test]
#[should_panic]
fn test_accept_admin_by_non_pending_address_rejected() {
    let env = Env::default();

    let (contract_id, admin) = init_with_scoped_auth(&env);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let new_admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_admin",
                args: (&new_admin,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .propose_admin(&new_admin);

    // Only the nominated address can finalize: `accept_admin` calls
    // `require_auth()` on the address read from `DataKey::PendingAdmin`, so an
    // auth entry signed by anyone else fails the invocation.
    client
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "accept_admin",
                args: vec![&env],
                sub_invokes: &[],
            },
        }])
        .accept_admin();
}

#[test]
#[should_panic]
fn test_propose_admin_by_non_admin_rejected() {
    let env = Env::default();

    let (contract_id, _admin) = init_with_scoped_auth(&env);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let attacker = Address::generate(&env);
    let attacker_pick = Address::generate(&env);

    client
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_admin",
                args: (&attacker_pick,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .propose_admin(&attacker_pick);
}

#[test]
fn test_accept_admin_without_pending_proposal_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    assert_eq!(client.try_accept_admin(), Err(Ok(Error::NoPendingAdmin)));
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_accept_admin_is_not_replayable() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    client.propose_admin(&new_admin);
    client.accept_admin();

    // The nomination was consumed, so a replay finds nothing pending rather
    // than re-running the handover.
    assert_eq!(client.try_accept_admin(), Err(Ok(Error::NoPendingAdmin)));
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_propose_admin_rejects_current_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    assert_eq!(
        client.try_propose_admin(&admin),
        Err(Ok(Error::InvalidAdminProposal))
    );
    assert_eq!(client.get_pending_admin(), None);
}

#[test]
fn test_admin_rights_move_to_new_admin_after_transfer() {
    let env = Env::default();

    let (contract_id, admin) = init_with_scoped_auth(&env);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let new_admin = Address::generate(&env);

    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_admin",
                args: (&new_admin,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .propose_admin(&new_admin);

    client
        .mock_auths(&[MockAuth {
            address: &new_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "accept_admin",
                args: vec![&env],
                sub_invokes: &[],
            },
        }])
        .accept_admin();

    assert_eq!(client.get_admin(), new_admin);

    // The new admin can exercise an admin-only entrypoint...
    client
        .mock_auths(&[MockAuth {
            address: &new_admin,
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
#[should_panic]
fn test_previous_admin_loses_rights_after_transfer() {
    let env = Env::default();

    let (contract_id, admin) = init_with_scoped_auth(&env);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let new_admin = Address::generate(&env);

    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_admin",
                args: (&new_admin,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .propose_admin(&new_admin);

    client
        .mock_auths(&[MockAuth {
            address: &new_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "accept_admin",
                args: vec![&env],
                sub_invokes: &[],
            },
        }])
        .accept_admin();

    // ...and the outgoing admin can no longer: admin-gated entrypoints read
    // `DataKey::Admin`, which now holds `new_admin`.
    client
        .mock_auths(&[MockAuth {
            address: &admin,
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
fn test_max_portfolio_assets_boundary_gas_cost() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    // 1. Construct portfolio with exactly MAX_PORTFOLIO_ASSETS (10)
    let user = Address::generate(&env);
    let mut allocations = Map::new(&env);
    for _ in 0..MAX_PORTFOLIO_ASSETS {
        let asset = Address::generate(&env);
        allocations.set(asset, 1000);
    }

    let portfolio_id = create_portfolio_with_defaults(&env, &client, &user, &allocations, 5, 50);
    assert_eq!(portfolio_id, 1);

    // 2. Companion test: Attempting MAX_PORTFOLIO_ASSETS + 1 (11) is rejected
    let mut oversized = Map::new(&env);
    for i in 0..11u32 {
        let a = Address::generate(&env);
        let pct = if i == 10 { 910 } else { 909 };
        oversized.set(a, pct);
    }
    let asset_decimals = allocation_decimals(&env, &oversized, DEFAULT_ASSET_DECIMALS);
    let res = client.try_create_portfolio(
        &user,
        &oversized,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );
    assert_eq!(res, Err(Ok(Error::TooManyAssets)));
}



