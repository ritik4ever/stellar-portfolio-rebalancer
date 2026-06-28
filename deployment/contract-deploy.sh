#!/usr/bin/env bash
set -euo pipefail

print_step() {
  printf '\n[%s] %s\n' "contract-deploy" "$1"
}

fail() {
  printf '[%s] ERROR: %s\n' "contract-deploy" "$1" >&2
  exit 1
}

DEPLOYMENT_ENVIRONMENT="${DEPLOYMENT_ENVIRONMENT:-}"
STELLAR_NETWORK="${STELLAR_NETWORK:-}"
STELLAR_SECRET_KEY="${STELLAR_SECRET_KEY:-}"
REFLECTOR_ADDRESS="${REFLECTOR_ADDRESS:-}"
SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-}"
SOROBAN_NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE:-}"
CONTRACT_ENV_FILE="${CONTRACT_ENV_FILE:-}"
DEPLOYMENT_SHA="${GITHUB_SHA:-${DEPLOYMENT_SHA:-}}"

if [ -z "$DEPLOYMENT_ENVIRONMENT" ]; then
  fail "DEPLOYMENT_ENVIRONMENT is required"
fi

if [ -z "$STELLAR_NETWORK" ]; then
  fail "STELLAR_NETWORK is required"
fi

if [ -z "$STELLAR_SECRET_KEY" ]; then
  fail "STELLAR_SECRET_KEY is required"
fi

if [ -z "$REFLECTOR_ADDRESS" ]; then
  fail "REFLECTOR_ADDRESS is required"
fi

case "$STELLAR_NETWORK" in
  testnet)
    SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
    SOROBAN_NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
    ;;
  mainnet)
    SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban-mainnet.stellar.org}"
    SOROBAN_NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"
    ;;
  *)
    fail "Unsupported STELLAR_NETWORK '$STELLAR_NETWORK' (expected testnet or mainnet)"
    ;;
esac

print_step "Building optimized contract wasm"
make -C contracts build-optimized

print_step "Configuring Soroban network profile"
soroban network add "$STELLAR_NETWORK" --global \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE" || true

print_step "Loading deployer key"
soroban keys add ci-deployer --global --secret-key "$STELLAR_SECRET_KEY" || true
ADMIN_ADDRESS="$(soroban keys address ci-deployer --global)"

print_step "Deploying contract to $DEPLOYMENT_ENVIRONMENT ($STELLAR_NETWORK)"
CONTRACT_ID="$(soroban contract deploy \
  --wasm contracts/target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source ci-deployer \
  --network "$STELLAR_NETWORK")"

if [ -z "$CONTRACT_ID" ]; then
  fail "Contract deployment did not return a contract ID"
fi

print_step "Initializing contract"
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source ci-deployer \
  --network "$STELLAR_NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --reflector_address "$REFLECTOR_ADDRESS"

if [ -n "$CONTRACT_ENV_FILE" ]; then
  print_step "Writing deployment metadata to $CONTRACT_ENV_FILE"
  mkdir -p "$(dirname "$CONTRACT_ENV_FILE")"
  cat > "$CONTRACT_ENV_FILE" <<EOF
DEPLOYMENT_ENVIRONMENT=$DEPLOYMENT_ENVIRONMENT
STELLAR_NETWORK=$STELLAR_NETWORK
CONTRACT_ID=$CONTRACT_ID
STELLAR_CONTRACT_ADDRESS=$CONTRACT_ID
CONTRACT_ADDRESS=$CONTRACT_ID
VITE_CONTRACT_ADDRESS=$CONTRACT_ID
REFLECTOR_ADDRESS=$REFLECTOR_ADDRESS
DEPLOYMENT_SHA=$DEPLOYMENT_SHA
EOF
fi

printf '\n[%s] Contract deployed: %s\n' "contract-deploy" "$CONTRACT_ID"
