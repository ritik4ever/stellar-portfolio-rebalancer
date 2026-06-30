#![no_main]

use libfuzzer_sys::fuzz_target;
use portfolio_rebalancer::portfolio::{balance_to_value, value_to_balance};
use portfolio_rebalancer::types::{DEFAULT_ASSET_DECIMALS, MIN_TRADE_AMOUNT_STROOPS};

fuzz_target!(|data: &[u8]| {
    if data.len() < 16 {
        return;
    }

    // Decode first 16 bytes as two i64s (price and balance)
    let price_bytes: [u8; 8] = data[0..8].try_into().unwrap();
    let balance_bytes: [u8; 8] = data[8..16].try_into().unwrap();
    let price = i64::from_le_bytes(price_bytes) as i128;
    let balance = i64::from_le_bytes(balance_bytes) as i128;

    // These must never panic for any input
    let value = balance_to_value(balance, price);
    let _ = value_to_balance(value, price, DEFAULT_ASSET_DECIMALS);

    // Explicitly test zero price — must return 0, not divide by zero
    let _ = value_to_balance(value, 0, DEFAULT_ASSET_DECIMALS);

    // Test extreme values that could overflow multiplication
    let extremes: &[(i128, i128)] = &[
        (0, 0),
        (1, 1),
        (i64::MAX as i128, i64::MAX as i128),
        (-1, 1),
        (1, -1),
        (MIN_TRADE_AMOUNT_STROOPS, 10i128.pow(14)),
        (10i128.pow(14) * 100_000, 10i128.pow(14)),
    ];

    for (b, p) in extremes {
        let v = balance_to_value(*b, *p);
        let _ = value_to_balance(v, *p, DEFAULT_ASSET_DECIMALS);
        let _ = value_to_balance(v, 0, DEFAULT_ASSET_DECIMALS);
    }
});
