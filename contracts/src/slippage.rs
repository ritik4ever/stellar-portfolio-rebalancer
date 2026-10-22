use soroban_sdk::{Address, Env, Symbol};

use crate::types::{
    DataKey, Error, DEFAULT_ASSET_SLIPPAGE_BPS, MAX_ASSET_SLIPPAGE_BPS,
    MAX_GLOBAL_MAX_SLIPPAGE_BPS,
};

/// Set the contract-level max execution slippage limit (in basis points) for a
/// given asset class.
///
/// Admin-only. The limit is clamped to [`MAX_ASSET_SLIPPAGE_BPS`] (500 bps /
/// 5%). Assets without an explicit limit fall back to
/// [`DEFAULT_ASSET_SLIPPAGE_BPS`] (100 bps / 1%) via [`get_asset_slippage`].
///
/// Emits a `("slippage_guard","configured")` event carrying the asset and the
/// new limit.
pub fn set_asset_slippage(env: &Env, asset: &Address, bps: u32) -> Result<(), Error> {
    if bps > MAX_ASSET_SLIPPAGE_BPS {
        return Err(Error::InvalidSlippageLimit);
    }
    env.storage()
        .persistent()
        .set(&DataKey::AssetSlippage(asset.clone()), &bps);

    env.events().publish(
        (
            Symbol::new(env, "slippage_guard"),
            Symbol::new(env, "configured"),
        ),
        (asset.clone(), bps),
    );
    Ok(())
}

/// Return the contract-level max execution slippage limit (in basis points)
/// configured for `asset`, falling back to [`DEFAULT_ASSET_SLIPPAGE_BPS`]
/// (100 bps / 1%) when no explicit limit has been set.
pub fn get_asset_slippage(env: &Env, asset: &Address) -> u32 {
    env.storage()
        .persistent()
        .get::<DataKey, u32>(&DataKey::AssetSlippage(asset.clone()))
        .unwrap_or(DEFAULT_ASSET_SLIPPAGE_BPS)
}

/// Guard that reverts a rebalance when the actual DEX execution price deviates
/// from the expected (oracle) price by more than the asset class's configured
/// max slippage limit.
///
/// Computes the price deviation in basis points and, when it exceeds the limit,
/// emits a `SlippageGuardTriggered` event carrying the asset, expected price,
/// actual price, max limit and measured deviation, then returns
/// [`Error::SlippageExceeded`].
pub fn check_execution_slippage(
    env: &Env,
    asset: &Address,
    expected_price: i128,
    actual_price: i128,
) -> Result<(), Error> {
    let max_bps = get_asset_slippage(env, asset);
    if expected_price <= 0 {
        return Err(Error::InvalidPrice);
    }

    let diff = expected_price - actual_price;
    let diff_abs = if diff >= 0 { diff } else { -diff };
    let actual_bps = (diff_abs * 10000) / expected_price;

    if actual_bps > max_bps as i128 {
        env.events().publish(
            (
                Symbol::new(env, "slippage_guard"),
                Symbol::new(env, "triggered"),
            ),
            (
                asset.clone(),
                expected_price,
                actual_price,
                max_bps,
                actual_bps as u32,
            ),
        );
        return Err(Error::SlippageExceeded);
    }
    Ok(())
}

/// Fail-closed variant of [`check_execution_slippage`] used for every
/// trade-related state change (#1856).
///
/// Unlike [`check_execution_slippage`], a zero, negative or absurd deviating
/// `actual_price` can never bypass the guard:
///
/// - `actual_price <= 0` (malformed or exploit input) is rejected with
///   [`Error::InvalidPrice`] instead of computing a division-by-zero or a
///   "negative" deviation that would pass.
/// - `actual_price > 10 * expected_price` (> +1000% deviation) is rejected
///   with [`Error::SlippageExceeded`] before any percentage math, so an
///   overflowed or inflated price can never wrap into a small `actual_bps`.
/// - For any other input the standard per-asset limit check applies
///   (default 1%, admin-configurable up to 5%).
pub fn check_execution_slippage_guarded(
    env: &Env,
    asset: &Address,
    expected_price: i128,
    actual_price: i128,
) -> Result<(), Error> {
    if expected_price <= 0 || actual_price <= 0 {
        return Err(Error::InvalidPrice);
    }
    // Fail closed on extreme positive deviations (> +1000%) before the
    // percentage computation: the product `diff_abs * 10000` stays far below
    // the i128 range for such inputs, but rejecting early also keeps any
    // future change to the math from reintroducing a wrap-around bypass.
    if actual_price > expected_price.saturating_mul(10) {
        return Err(Error::SlippageExceeded);
    }
    check_execution_slippage(env, asset, expected_price, actual_price)
}

/// Clamp `bps` to the contract-level aggregate bound
/// [`MAX_GLOBAL_MAX_SLIPPAGE_BPS`] (1000 bps / 10%).
///
/// Used when a portfolio's `global_max_slippage_bps` is set or written so a
/// user or admin cannot configure an aggregate slippage cap that exceeds the
/// contract-level bound, and when the aggregate check runs so values stored
/// before the bound existed are still enforced at the capped level.
pub fn cap_global_max_slippage_bps(bps: u32) -> u32 {
    if bps > MAX_GLOBAL_MAX_SLIPPAGE_BPS {
        MAX_GLOBAL_MAX_SLIPPAGE_BPS
    } else {
        bps
    }
}
