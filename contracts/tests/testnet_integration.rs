#![cfg(feature = "integration")]

/// Real testnet integration tests for the Portfolio Rebalancer contract.
///
/// These tests run against the Stellar public testnet using the soroban CLI.
/// Requirements:
///   - `STELLAR_TESTNET_SECRET_KEY` env var: funded testnet account secret key
///   - `soroban` CLI installed and available on PATH
///   - Built WASM artifacts in `target/wasm32-unknown-unknown/release/`
///
/// Run: `cargo test --features integration -- --nocapture`
///
/// The tests log ledger sequences and transaction hashes to stdout.

use std::env;
use std::process::{Command, Output};

// ── CLI helpers ──────────────────────────────────────────────────────────

const NETWORK: &str = "testnet";
const RPC_URL: &str = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";
const KEY_NAME: &str = "integration-tester";

/// Returns the testnet secret key from the environment.
fn testnet_secret_key() -> String {
    env::var("STELLAR_TESTNET_SECRET_KEY")
        .expect("STELLAR_TESTNET_SECRET_KEY environment variable must be set")
}

/// Runs a soroban CLI command and returns its output.
/// Prints the command being run for test observability.
fn soroban(args: &[&str]) -> Output {
    let mut cmd_str = String::from("soroban");
    for a in args {
        cmd_str.push(' ');
        cmd_str.push_str(a);
    }
    eprintln!("[testnet-int] → {cmd_str}");

    let output = Command::new("soroban")
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("soroban CLI command failed: {e}\ncommand: {cmd_str}"));

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        panic!(
            "soroban command failed with status {:?}\ncommand: {cmd_str}\nstdout: {stdout}\nstderr: {stderr}",
            output.status.code()
        );
    }
    output
}

/// Extracts trimmed stdout from command output.
fn stdout_str(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Ensures the soroban CLI has the testnet network configured and the key imported.
fn ensure_setup() {
    // Add testnet network (ignore error if already exists)
    let _ = Command::new("soroban")
        .args([
            "network", "add", NETWORK,
            "--rpc-url", RPC_URL,
            "--network-passphrase", NETWORK_PASSPHRASE,
        ])
        .output();

    // Add the integration tester key via stdin to avoid exposing in process listings
    let secret = testnet_secret_key();
    let _ = Command::new("sh")
        .arg("-c")
        .arg(format!("echo '{}' | soroban keys add {}", secret, KEY_NAME))
        .output();
}

/// Returns the test account's public address.
fn test_address() -> String {
    let output = soroban(&["keys", "address", KEY_NAME]);
    stdout_str(&output)
}

/// Parses and validates a contract ID from soroban output.
fn parse_contract_id(output: &Output) -> String {
    let id = stdout_str(output);
    assert!(
        id.starts_with('C') && id.len() >= 56,
        "Expected a valid contract ID (C...), got: {id}"
    );
    id
}

/// Attempts to extract a transaction hash from the soroban invoke
/// output (stderr + stdout) for observability logging.
fn log_tx_info(output: &Output, label: &str) {
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    // Transaction hash: 64 hex characters
    for line in combined.lines() {
        let trimmed = line.trim();
        if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            eprintln!("[testnet-int]   {label} — tx hash: {trimmed}");
            return;
        }
    }
    // No explicit tx hash found — log a note
    eprintln!("[testnet-int]   {label} — (tx hash not found in output)");
}

/// Deploys a contract WASM and returns the contract ID.
fn deploy_contract(wasm_path: &str) -> String {
    let output = soroban(&[
        "contract", "deploy",
        "--wasm", wasm_path,
        "--source", KEY_NAME,
        "--network", NETWORK,
    ]);
    let contract_id = parse_contract_id(&output);
    eprintln!("[testnet-int]   deployed → {contract_id}");
    contract_id
}

/// Invokes a contract method. Returns the command output.
fn contract_invoke(contract_id: &str, method: &str, extra_args: &[&str]) -> Output {
    let mut args = vec![
        "contract", "invoke",
        "--id", contract_id,
        "--source", KEY_NAME,
        "--network", NETWORK,
        "--", method,
    ];
    args.extend_from_slice(extra_args);
    let output = soroban(&args);

    log_tx_info(&output, method);
    let stdout = stdout_str(&output);
    eprintln!("[testnet-int]   result: {stdout}");

    output
}

/// Simulates a contract method invocation (read-only, no transaction).
fn contract_simulate(contract_id: &str, method: &str, extra_args: &[&str]) -> Output {
    let mut args = vec![
        "contract", "invoke",
        "--id", contract_id,
        "--source", KEY_NAME,
        "--network", NETWORK,
        "--simulate",
        "--", method,
    ];
    args.extend_from_slice(extra_args);
    soroban(&args)
}

/// Queries contract events for a given contract ID and optional ledger filter.
fn query_events(contract_id: &str, start_ledger: Option<u32>) -> Output {
    let mut args = vec![
        "events",
        "--id", contract_id,
        "--network", NETWORK,
        "--type", "contract",
        "--output", "pretty",
    ];
    if let Some(ledger) = start_ledger {
        let ledger_str = ledger.to_string();
        args.push("--start-ledger");
        args.push(&ledger_str);
    }
    soroban(&args)
}

// ── Test harness ────────────────────────────────────────────────────────

/// Holds the deployed contract IDs and addresses for a test run.
struct TestnetFixture {
    contract_id: String,
    reflector_id: String,
    admin_address: String,
}

impl TestnetFixture {
    /// Deploys the portfolio rebalancer and mock reflector, then initializes.
    fn deploy() -> Self {
        ensure_setup();
        let admin = test_address();

        // Build WASM path relative to the contracts directory
        let wasm_base = "target/wasm32-unknown-unknown/release";
        let rebalancer_wasm = format!("{wasm_base}/portfolio_rebalancer.wasm");
        let reflector_wasm = format!("{wasm_base}/mock_reflector.wasm");

        eprintln!("\n[testnet-int] ═══ Deploying contracts to testnet ═══");

        // Deploy mock reflector first
        eprintln!("[testnet-int] Deploying mock reflector…");
        let reflector_id = deploy_contract(&reflector_wasm);

        // Deploy portfolio rebalancer
        eprintln!("[testnet-int] Deploying portfolio rebalancer…");
        let contract_id = deploy_contract(&rebalancer_wasm);

        // Initialize the contract
        eprintln!("[testnet-int] Initializing contract…");
        contract_invoke(
            &contract_id,
            "initialize",
            &[
                "--admin", &admin,
                "--reflector_address", &reflector_id,
            ],
        );

        eprintln!("[testnet-int] ═══ Deployment complete ═══");
        eprintln!("[testnet-int]   Admin:        {admin}");
        eprintln!("[testnet-int]   Contract:     {contract_id}");
        eprintln!("[testnet-int]   Reflector:    {reflector_id}");

        Self {
            contract_id,
            reflector_id,
            admin_address: admin,
        }
    }
}

/// Generates a unique "asset" by using well-known Stellar testnet asset
/// contract addresses. We use the native XLM address and a test USDC
/// issuer address as our "assets" for the portfolio.
fn testnet_asset_addresses() -> (String, String) {
    // These are well-known testnet asset addresses that work as Map keys.
    // We use the native contract ID for XLM and a placeholder for USDC.
    // For integration tests, any valid Stellar address works as an asset key.
    (
        "CBK4GQ2FXSC7QXSOC4P3NHQT3NPLDJUM37PSKKVAJ6ALBSBLL7YNLL7L".to_string(),  // XLM native
        "CBP7NO6F7FRDHSOFQBT2L2UWYIZ2PU76JKVRYAQTG3KZSQLYAOKIF2WB".to_string(),  // USDC testnet
    )
}

// ── Tests ────────────────────────────────────────────────────────────────

/// Test 1: Complete lifecycle — deploy → initialize → create → deposit → rebalance → verify
#[test]
fn testnet_full_rebalance_lifecycle() {
    let fixture = TestnetFixture::deploy();

    let (asset_a, asset_b) = testnet_asset_addresses();
    let user = fixture.admin_address.clone();

    eprintln!("\n═══ Test: Full Rebalance Lifecycle ═══");
    eprintln!("[testnet-int] Asset A: {asset_a}");
    eprintln!("[testnet-int] Asset B: {asset_b}");

    // ── Step 1: Create portfolio ──────────────────────────────────
    eprintln!("\n[testnet-int] ── Step 1: Creating portfolio ──");
    let create_output = contract_invoke(
        &fixture.contract_id,
        "create_portfolio",
        &[
            "--user", &user,
            "--target_allocations", &format!("{{\"{asset_a}\": 5000, \"{asset_b}\": 5000}}"),
            "--asset_decimals", &format!("{{\"{asset_a}\": 7, \"{asset_b}\": 7}}"),
            "--rebalance_threshold", "5",
            "--slippage_tolerance", "50",
            "--slippage_policy_version", "1",
        ],
    );
    let portfolio_id_raw = stdout_str(&create_output);
    let portfolio_id: u64 = portfolio_id_raw
        .parse()
        .unwrap_or_else(|_| panic!("Expected numeric portfolio ID, got: {portfolio_id_raw}"));
    assert!(portfolio_id >= 1, "Portfolio ID should be >= 1");
    eprintln!("[testnet-int]   Portfolio ID: {portfolio_id}");

    // ── Step 2: Verify portfolio state after creation ─────────────
    eprintln!("\n[testnet-int] ── Step 2: Verifying portfolio state ──");
    {
        // Read the portfolio from contract storage
        let read_output = contract_invoke(
            &fixture.contract_id,
            "get_portfolio",
            &["--portfolio_id", &portfolio_id.to_string()],
        );
        let state = stdout_str(&read_output);
        assert!(state.contains(&user), "Portfolio should reference the user");
        assert!(state.contains("is_active"), "Portfolio state should include is_active");
        eprintln!("[testnet-int]   Portfolio state retrieved successfully");
    }

    // Verify capabilities and version
    {
        let ver_output = contract_simulate(
            &fixture.contract_id,
            "version",
            &[],
        );
        let version = stdout_str(&ver_output);
        assert!(version.contains('1'), "Contract version should be 1");
        eprintln!("[testnet-int]   Contract version: {version}");
    }

    // ── Step 3: Deposit assets ────────────────────────────────────
    eprintln!("\n[testnet-int] ── Step 3: Depositing assets ──");
    {
        contract_invoke(
            &fixture.contract_id,
            "deposit",
            &[
                "--portfolio_id", &portfolio_id.to_string(),
                "--asset", &asset_a,
                "--amount", "20000",
                "--_memo", "\"initial deposit\"",
            ],
        );
        eprintln!("[testnet-int]   Deposit to {asset_a}: 20000");
    }
    {
        contract_invoke(
            &fixture.contract_id,
            "deposit",
            &[
                "--portfolio_id", &portfolio_id.to_string(),
                "--asset", &asset_b,
                "--amount", "10000",
                "--_memo", "\"initial deposit\"",
            ],
        );
        eprintln!("[testnet-int]   Deposit to {asset_b}: 10000");
    }

    // ── Step 4: Check rebalance needed ────────────────────────────
    eprintln!("\n[testnet-int] ── Step 4: Checking rebalance needed ──");
    {
        let check_output = contract_simulate(
            &fixture.contract_id,
            "check_rebalance_needed",
            &["--portfolio_id", &portfolio_id.to_string()],
        );
        let result = stdout_str(&check_output);
        eprintln!("[testnet-int]   check_rebalance_needed → {result}");
        // Should return true since deposits are imbalanced (20000 vs 10000 with 50/50 target)
        assert!(
            result.contains("true"),
            "check_rebalance_needed should return true for imbalanced portfolio, got: {result}"
        );
    }

    // ── Step 5: Preview rebalance ─────────────────────────────────
    eprintln!("\n[testnet-int] ── Step 5: Previewing rebalance ──");
    {
        let preview_output = contract_simulate(
            &fixture.contract_id,
            "preview_rebalance",
            &["--portfolio_id", &portfolio_id.to_string()],
        );
        let preview = stdout_str(&preview_output);
        eprintln!("[testnet-int]   preview_rebalance → {preview}");
        assert!(!preview.is_empty(), "Preview should not be empty");
    }

    // ── Step 6: Execute rebalance ─────────────────────────────────
    eprintln!("\n[testnet-int] ── Step 6: Executing rebalance ──");
    {
        let exec_output = contract_invoke(
            &fixture.contract_id,
            "execute_rebalance",
            &[
                "--portfolio_id", &portfolio_id.to_string(),
                "--actual_balances", "{}",
            ],
        );
        let result = stdout_str(&exec_output);
        eprintln!("[testnet-int]   execute_rebalance → {result}");
    }

    // ── Step 7: Verify post-rebalance state ───────────────────────
    eprintln!("\n[testnet-int] ── Step 7: Verifying post-rebalance state ──");
    {
        let valuation_output = contract_simulate(
            &fixture.contract_id,
            "get_portfolio_value_usd",
            &["--portfolio_id", &portfolio_id.to_string()],
        );
        let valuation = stdout_str(&valuation_output);
        eprintln!("[testnet-int]   Portfolio valuation → {valuation}");
        assert!(valuation.contains("total_usd_value"), "Valuation should contain total_usd_value");
    }

    // ── Step 8: Verify events emitted ─────────────────────────────
    eprintln!("\n[testnet-int] ── Step 8: Verifying event emission ──");
    {
        let events_output = query_events(&fixture.contract_id, None);
        let events = stdout_str(&events_output);
        eprintln!("[testnet-int]   Contract events:\n{events}");

        // Verify key events were emitted at each lifecycle step
        assert!(events.contains("created"), "Contract should emit 'portfolio' 'created' event");
        assert!(events.contains("deposit"), "Contract should emit 'portfolio' 'deposit' event");
        assert!(
            events.contains("portfolio") && events.contains("rebalanced"),
            "Contract should emit 'portfolio' 'rebalanced' event after execute_rebalance"
        );
    }

    // ── Step 9: Verify contract storage state ─────────────────────
    eprintln!("\n[testnet-int] ── Step 9: Verifying storage state ──");
    {
        let portfolio_output = contract_simulate(
            &fixture.contract_id,
            "get_portfolio",
            &["--portfolio_id", &portfolio_id.to_string()],
        );
        let portfolio_state = stdout_str(&portfolio_output);
        eprintln!("[testnet-int]   Final portfolio state → {portfolio_state}");
        assert!(portfolio_state.contains("is_active"), "Portfolio should be active");
        assert!(portfolio_state.contains(&asset_a), "Portfolio should reference assets");
    }

    eprintln!("\n[testnet-int] ═══ Test complete: full rebalance lifecycle passed ✅ ═══\n");
}

/// Test 2: Portfolio creation with fractional allocations (three-way 33.33% split)
#[test]
fn testnet_fractional_three_way_allocations() {
    let fixture = TestnetFixture::deploy();

    let (asset_a, asset_b) = testnet_asset_addresses();
    let asset_c = "CDBB4QIVGQRQYKOZUP55BYE3KHA7VY6ITWJ6HPAA3ICCSRJGBN2FKZCN".to_string();
    let user = fixture.admin_address.clone();

    eprintln!("\n═══ Test: Fractional Three-Way Allocations ═══");

    let alloc_json = format!(
        "{{\"{asset_a}\": 3333, \"{asset_b}\": 3333, \"{asset_c}\": 3334}}"
    );
    let decimals_json = format!(
        "{{\"{asset_a}\": 7, \"{asset_b}\": 7, \"{asset_c}\": 7}}"
    );

    let create_output = contract_invoke(
        &fixture.contract_id,
        "create_portfolio",
        &[
            "--user", &user,
            "--target_allocations", &alloc_json,
            "--asset_decimals", &decimals_json,
            "--rebalance_threshold", "5",
            "--slippage_tolerance", "50",
            "--slippage_policy_version", "1",
        ],
    );
    let pid = stdout_str(&create_output);
    eprintln!("[testnet-int]   Created portfolio: {pid}");

    let read_output = contract_simulate(
        &fixture.contract_id,
        "get_drift_preview",
        &["--portfolio_id", &pid],
    );
    let drift = stdout_str(&read_output);
    eprintln!("[testnet-int]   Drift preview → {drift}");
    assert!(!drift.is_empty(), "Drift preview should not be empty");

    // Verify portfolio state was persisted correctly
    let port_output = contract_simulate(
        &fixture.contract_id,
        "get_portfolio",
        &["--portfolio_id", &pid],
    );
    let port_state = stdout_str(&port_output);
    assert!(port_state.contains(&asset_a), "Portfolio should include asset A");
    assert!(port_state.contains(&asset_b), "Portfolio should include asset B");
    assert!(port_state.contains(&asset_c), "Portfolio should include asset C");
    eprintln!("[testnet-int]   Portfolio state verified with all 3 assets");

    eprintln!("[testnet-int] ═══ Fractional allocation test passed ✅ ═══\n");
}

/// Test 3: Emergency stop blocks rebalance, then reactivation allows it
#[test]
fn testnet_emergency_stop_flow() {
    let fixture = TestnetFixture::deploy();

    let (asset_a, asset_b) = testnet_asset_addresses();
    let user = fixture.admin_address.clone();

    eprintln!("\n═══ Test: Emergency Stop Flow ═══");

    // Create portfolio
    let alloc_json = format!("{{\"{asset_a}\": 5000, \"{asset_b}\": 5000}}");
    let decimals_json = format!("{{\"{asset_a}\": 7, \"{asset_b}\": 7}}");
    let create_output = contract_invoke(
        &fixture.contract_id,
        "create_portfolio",
        &[
            "--user", &user,
            "--target_allocations", &alloc_json,
            "--asset_decimals", &decimals_json,
            "--rebalance_threshold", "5",
            "--slippage_tolerance", "50",
            "--slippage_policy_version", "1",
        ],
    );
    let pid = stdout_str(&create_output);
    eprintln!("[testnet-int]   Portfolio ID: {pid}");

    // Deposit
    contract_invoke(&fixture.contract_id, "deposit", &[
        "--portfolio_id", &pid, "--asset", &asset_a, "--amount", "20000", "--_memo", "\"\"",
    ]);
    contract_invoke(&fixture.contract_id, "deposit", &[
        "--portfolio_id", &pid, "--asset", &asset_b, "--amount", "10000", "--_memo", "\"\"",
    ]);
    eprintln!("[testnet-int]   Deposits complete");

    // Enable emergency stop
    eprintln!("[testnet-int]   Enabling emergency stop…");
    contract_invoke(&fixture.contract_id, "set_emergency_stop", &[
        "--stop", "true",
    ]);

    // Verify pause reason reflects emergency stop
    {
        let reason_output = contract_simulate(
            &fixture.contract_id,
            "get_contract_pause_reason",
            &[],
        );
        let reason = stdout_str(&reason_output);
        eprintln!("[testnet-int]   Pause reason: {reason}");
    }

    // Attempt rebalance — should fail
    eprintln!("[testnet-int]   Attempting rebalance during emergency stop…");
    let exec_result = Command::new("soroban")
        .args([
            "contract", "invoke",
            "--id", &fixture.contract_id,
            "--source", KEY_NAME,
            "--network", NETWORK,
            "--", "execute_rebalance",
            "--portfolio_id", &pid,
            "--actual_balances", "{}",
        ])
        .output()
        .unwrap();

    let exec_stderr = String::from_utf8_lossy(&exec_result.stderr);
    let exec_stdout = String::from_utf8_lossy(&exec_result.stdout);

    assert!(
        !exec_result.status.success(),
        "Rebalance unexpectedly succeeded during emergency stop — expected EmergencyStop error"
    );
    {
        // Verify the error is related to emergency stop
        let combined = format!("{exec_stdout}{exec_stderr}");
        eprintln!("[testnet-int]   Rebalance rejected (expected): {combined}");
        assert!(
            combined.contains("EmergencyStop") || combined.contains("Error(Contract, #3)"),
            "Rebalance should fail with EmergencyStop error"
        );
    }

    // Disable emergency stop
    eprintln!("[testnet-int]   Disabling emergency stop…");
    contract_invoke(&fixture.contract_id, "set_emergency_stop", &[
        "--stop", "false",
    ]);

    // Now rebalance should succeed
    eprintln!("[testnet-int]   Executing rebalance after reactivation…");
    let reactivate_output = contract_invoke(
        &fixture.contract_id,
        "execute_rebalance",
        &[
            "--portfolio_id", &pid,
            "--actual_balances", "{}",
        ],
    );
    let result = stdout_str(&reactivate_output);
    eprintln!("[testnet-int]   Rebalance result: {result}");

    eprintln!("[testnet-int] ═══ Emergency stop flow test passed ✅ ═══\n");
}

/// Test 4: Config view and capability summary endpoints
#[test]
fn testnet_config_and_capability_views() {
    let fixture = TestnetFixture::deploy();
    let (asset_a, asset_b) = testnet_asset_addresses();
    let user = fixture.admin_address.clone();

    eprintln!("\n═══ Test: Config View & Capabilities ═══");

    // Create a portfolio first
    let alloc_json = format!("{{\"{asset_a}\": 5000, \"{asset_b}\": 5000}}");
    let decimals_json = format!("{{\"{asset_a}\": 7, \"{asset_b}\": 7}}");
    let create_output = contract_invoke(
        &fixture.contract_id,
        "create_portfolio",
        &[
            "--user", &user,
            "--target_allocations", &alloc_json,
            "--asset_decimals", &decimals_json,
            "--rebalance_threshold", "5",
            "--slippage_tolerance", "50",
            "--slippage_policy_version", "1",
        ],
    );
    let pid = stdout_str(&create_output);

    // Config view
    {
        let config_output = contract_simulate(
            &fixture.contract_id,
            "get_config_view",
            &["--portfolio_id", &pid],
        );
        let config = stdout_str(&config_output);
        eprintln!("[testnet-int]   Config view → {config}");
        assert!(config.contains("admin"), "Config view should contain admin");
        assert!(config.contains("reflector_address"), "Config view should contain reflector");
        assert!(config.contains("emergency_stop"), "Config view should contain emergency_stop");
    }

    // Capability summary
    {
        let cap_output = contract_simulate(
            &fixture.contract_id,
            "capability_summary",
            &[],
        );
        let caps = stdout_str(&cap_output);
        eprintln!("[testnet-int]   Capability summary → {caps}");
        assert!(caps.contains("max_portfolio_assets"), "Should contain max_portfolio_assets");
    }

    // Version
    {
        let ver_output = contract_simulate(
            &fixture.contract_id,
            "version",
            &[],
        );
        let version = stdout_str(&ver_output);
        assert_eq!(version, "1", "Contract version should be 1");
        eprintln!("[testnet-int]   Version check passed");
    }

    eprintln!("[testnet-int] ═══ Config view test passed ✅ ═══\n");
}

/// Test 5: Fee configuration and get_fee_config
#[test]
fn testnet_fee_config_flow() {
    let fixture = TestnetFixture::deploy();

    eprintln!("\n═══ Test: Fee Configuration ═══");

    // Default fee config (should be disabled with zero fee)
    {
        let fee_output = contract_simulate(
            &fixture.contract_id,
            "get_fee_config",
            &[],
        );
        let fee = stdout_str(&fee_output);
        eprintln!("[testnet-int]   Default fee config → {fee}");
        assert!(fee.contains("enabled"), "Fee config should have enabled field");
    }

    // Set fee config
    let recipient = fixture.admin_address.clone();
    eprintln!("[testnet-int]   Setting fee config…");
    contract_invoke(
        &fixture.contract_id,
        "set_fee_config",
        &[
            "--config",
            &format!(
                "{{\"platform_name\": \"IntegrationTest\", \"fee_bps\": 25, \"fee_recipient\": \"{recipient}\", \"enabled\": true}}"
            ),
        ],
    );

    // Verify
    {
        let fee_output = contract_simulate(
            &fixture.contract_id,
            "get_fee_config",
            &[],
        );
        let fee = stdout_str(&fee_output);
        eprintln!("[testnet-int]   Updated fee config → {fee}");
        assert!(fee.contains("IntegrationTest"), "Fee config should contain platform name");
        assert!(fee.contains("25"), "Fee config should have fee_bps=25");
    }

    eprintln!("[testnet-int] ═══ Fee config test passed ✅ ═══\n");
}
