#!/usr/bin/env bash
set -euo pipefail

echo "::group::Setup"
soroban network add testnet --global --rpc-url "${SOROBAN_RPC_URL}" --network-passphrase "${SOROBAN_NETWORK_PASSPHRASE}" || true
soroban keys add ci-deployer --global --secret-key "${STELLAR_SECRET_KEY}" || true
ADMIN_ADDRESS="$(soroban keys address ci-deployer --global)"
echo "Admin address: $ADMIN_ADDRESS"
echo "::endgroup::"

echo "::group::Deploy Contract"
CONTRACT_ID="$(soroban contract deploy --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm --source ci-deployer --network testnet)"
if [ -z "${CONTRACT_ID}" ]; then
  echo "::error::Contract deployment did not return a contract ID"
  exit 1
fi
echo "Deployed Contract ID: $CONTRACT_ID"
echo "::endgroup::"

echo "::group::Initialize"
# Generate a random address for the reflector just for testing
REFLECTOR_ADDRESS=$(soroban keys generate tmp-reflector --network testnet | grep "Public Key" | awk '{print $3}' || echo "$ADMIN_ADDRESS")
# Fallback to admin if the above fails
if [ -z "$REFLECTOR_ADDRESS" ]; then
    REFLECTOR_ADDRESS="$ADMIN_ADDRESS"
fi

soroban contract invoke \
  --id "${CONTRACT_ID}" \
  --source ci-deployer \
  --network testnet \
  -- initialize \
  --admin "${ADMIN_ADDRESS}" \
  --reflector_address "${REFLECTOR_ADDRESS}"
echo "::endgroup::"

echo "::group::Deploy Test Assets"
ASSET_A="$(soroban contract asset deploy --asset native --source ci-deployer --network testnet)"
ASSET_B="$(soroban contract asset deploy --asset native --source ci-deployer --network testnet)"
# Actually asset deploy native just returns the native token contract ID (XLM).
# We need two different assets. Let's just generate two random ones if needed, or just use native and a random string.
# Wait, soroban contract deploy doesn't easily create a token. 
# Let's just use the SAC token (Stellar Asset Contract) or two dummy token contracts.
# Since we only need to pass them to create_portfolio, we can just use random addresses!
ASSET_A=$(soroban keys generate asset-a --network testnet)
ASSET_A=$(soroban keys address asset-a)
ASSET_B=$(soroban keys generate asset-b --network testnet)
ASSET_B=$(soroban keys address asset-b)

echo "Asset A: $ASSET_A"
echo "Asset B: $ASSET_B"
echo "::endgroup::"

echo "::group::Create Portfolio"
ALLOCATIONS="{\"$ASSET_A\": 5000, \"$ASSET_B\": 5000}"
DECIMALS="{\"$ASSET_A\": 7, \"$ASSET_B\": 7}"

PORTFOLIO_ID="$(soroban contract invoke \
  --id "${CONTRACT_ID}" \
  --source ci-deployer \
  --network testnet \
  -- create_portfolio \
  --user "${ADMIN_ADDRESS}" \
  --target_allocations "$ALLOCATIONS" \
  --asset_decimals "$DECIMALS" \
  --rebalance_threshold 500 \
  --slippage_tolerance 500 \
  --slippage_policy_version 1)"

if [ -z "${PORTFOLIO_ID}" ]; then
  echo "::error::Failed to create portfolio"
  exit 1
fi
echo "Created Portfolio ID: $PORTFOLIO_ID"
echo "::endgroup::"

echo "::group::Rebalance"
# simple rebalance
# pub fn rebalance(env: Env, portfolio_id: u64)
soroban contract invoke \
  --id "${CONTRACT_ID}" \
  --source ci-deployer \
  --network testnet \
  -- rebalance \
  --portfolio_id "${PORTFOLIO_ID}"
echo "Rebalance successful!"
echo "::endgroup::"

echo "Smoke test complete."
