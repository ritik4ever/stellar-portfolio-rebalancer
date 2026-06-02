# Stellar Portfolio Rebalancer Contract Makefile



# Default target
all: build

# Build the contract
build:
	cargo build --target wasm32-unknown-unknown --release
	@$(MAKE) hash

# Build with optimization
build-optimized:
	cargo build --target wasm32-unknown-unknown --release
	@if command -v soroban >/dev/null 2>&1; then \
		soroban contract optimize --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm; \
	else \
		echo "Soroban CLI not found. Install it for optimization."; \
	fi
	@$(MAKE) hash

# Calculate WASM hash
hash:
	@if [ -f target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm ]; then \
		if command -v sha256sum >/dev/null 2>&1; then \
			echo -n "WASM Hash (Release):    " && sha256sum target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm | cut -d' ' -f1; \
		elif command -v shasum >/dev/null 2>&1; then \
			echo -n "WASM Hash (Release):    " && shasum -a 256 target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm | cut -d' ' -f1; \
		else \
			echo -n "WASM Hash (Release):    " && openssl dgst -sha256 target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm | awk '{print $$NF}'; \
		fi; \
	else \
		echo "WASM target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm not found. Build it first."; \
	fi
	@if [ -f target/wasm32-unknown-unknown/release/portfolio_rebalancer.optimized.wasm ]; then \
		if command -v sha256sum >/dev/null 2>&1; then \
			echo -n "WASM Hash (Optimized):  " && sha256sum target/wasm32-unknown-unknown/release/portfolio_rebalancer.optimized.wasm | cut -d' ' -f1; \
		elif command -v shasum >/dev/null 2>&1; then \
			echo -n "WASM Hash (Optimized):  " && shasum -a 256 target/wasm32-unknown-unknown/release/portfolio_rebalancer.optimized.wasm | cut -d' ' -f1; \
		else \
			echo -n "WASM Hash (Optimized):  " && openssl dgst -sha256 target/wasm32-unknown-unknown/release/portfolio_rebalancer.optimized.wasm | awk '{print $$NF}'; \
		fi; \
	fi

# Run tests
test:
	cargo test

# Run gas/cost benchmarks
bench:
	cargo test benchmark_

# Run benchmarks and emit JSON output for CI diffing
bench-json:
	cargo test benchmark_ -- --nocapture 2>/dev/null | \
	awk '/^BENCHMARK_RESULT\|/ {split($$0, a, "|"); printf "{\"benchmark\":\"%s\",\"cpu\":%s,\"baseline_cpu\":%s,\"mem\":%s,\"baseline_mem\":%s}\n", a[2], a[3], a[4], a[5], a[6]}' | \
	jq -s '.' > bench_results.json 2>/dev/null || \
	cargo test benchmark_ -- --nocapture 2>/dev/null | \
	grep '^BENCHMARK_RESULT|' | \
	sed 's/^BENCHMARK_RESULT|//' | \
	awk -F'|' '{printf "{\"benchmark\":\"%s\",\"cpu\":%s,\"baseline_cpu\":%s,\"mem\":%s,\"baseline_mem\":%s}\n", $$1, $$2, $$3, $$4, $$5}' > bench_results.json

# Clean build artifacts
clean:
	cargo clean
	rm -f *.wasm

# Deploy to testnet
deploy-testnet:
	@if [ -z "$(STELLAR_SECRET_KEY)" ]; then \
		echo "Error: STELLAR_SECRET_KEY environment variable is required"; \
		exit 1; \
	fi
	@if command -v soroban >/dev/null 2>&1; then \
		soroban contract deploy \
			--wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
			--source $(STELLAR_SECRET_KEY) \
			--network testnet; \
	else \
		echo "Error: Soroban CLI is required for deployment"; \
		exit 1; \
	fi

# Deploy to mainnet (with confirmation)
deploy-mainnet:
	@echo "⚠️  WARNING: You are about to deploy to MAINNET!"
	@echo "This will use real XLM and cannot be undone."
	@read -p "Are you sure you want to continue? (y/N): " confirm && \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		if [ -z "$(STELLAR_SECRET_KEY)" ]; then \
			echo "Error: STELLAR_SECRET_KEY environment variable is required"; \
			exit 1; \
		fi; \
		if command -v soroban >/dev/null 2>&1; then \
			soroban contract deploy \
				--wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
				--source $(STELLAR_SECRET_KEY) \
				--network mainnet; \
		else \
			echo "Error: Soroban CLI is required for deployment"; \
			exit 1; \
		fi; \
	else \
		echo "Deployment cancelled."; \
	fi

# Initialize deployed contract
init-contract:
	@if [ -z "$(CONTRACT_ID)" ]; then \
		echo "Error: CONTRACT_ID environment variable is required"; \
		exit 1; \
	fi
	@if [ -z "$(REFLECTOR_ADDRESS)" ]; then \
		echo "Error: REFLECTOR_ADDRESS environment variable is required"; \
		exit 1; \
	fi
	soroban contract invoke \
		--id $(CONTRACT_ID) \
		--source $(STELLAR_SECRET_KEY) \
		--network $(STELLAR_NETWORK) \
		-- initialize \
		--admin $(shell soroban keys address deployer) \
		--reflector_address $(REFLECTOR_ADDRESS)

# Install required tools
install-tools:
	@echo "Installing required tools..."
	@if ! command -v soroban >/dev/null 2>&1; then \
		echo "Installing Soroban CLI..."; \
		cargo install --locked soroban-cli; \
	fi
	@if ! rustup target list --installed | grep -q wasm32-unknown-unknown; then \
		echo "Adding WASM target..."; \
		rustup target add wasm32-unknown-unknown; \
	fi

# Local Soroban testnet bootstrap for fresh clones
setup-testnet:
	@echo "Setting up local Soroban testnet prerequisites..."
	@if ! command -v rustup >/dev/null 2>&1; then \
		echo "Error: rustup is required (https://rustup.rs/)"; \
		exit 1; \
	fi
	@if ! rustup target list --installed | grep -q wasm32-unknown-unknown; then \
		echo "Adding WASM target..."; \
		rustup target add wasm32-unknown-unknown; \
	fi
	@if ! command -v soroban >/dev/null 2>&1; then \
		echo "Installing soroban-cli via cargo..."; \
		cargo install --locked soroban-cli; \
	fi
	@if ! soroban keys address deployer >/dev/null 2>&1; then \
		echo "Creating local deployer identity..."; \
		soroban keys generate deployer; \
	fi
	@if ! soroban network ls | grep -q '^testnet$$'; then \
		echo "Adding Soroban testnet network profile..."; \
		soroban network add testnet \
			--rpc-url https://soroban-testnet.stellar.org \
			--network-passphrase "Test SDF Network ; September 2015"; \
	fi
	@echo "Soroban testnet setup complete."
	@echo "Next steps:"
	@echo "  1) Fund deployer: soroban keys address deployer"
	@echo "  2) Build: make build"
	@echo "  3) Deploy: soroban contract deploy --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm --source deployer --network testnet"
	@echo "  For more commands, see docs/soroban-cookbook.md"

# Snapshot diff: compare two snapshot directories or files
# Usage: make snapshot-diff BEFORE=<path> AFTER=<path> [ARGS=--json]
snapshot-diff:
	@if [ -z "$(BEFORE)" ] || [ -z "$(AFTER)" ]; then \
		echo "Usage: make snapshot-diff BEFORE=<before-dir-or-file> AFTER=<after-dir-or-file> [ARGS=--json]"; \
		exit 1; \
	fi
	node ../scripts/snapshot-diff.mjs $(BEFORE) $(AFTER) $(ARGS)

# Help target
help:
	@echo "Available targets:"
	@echo "  build           - Build the contract"
	@echo "  build-optimized - Build with optimization"
	@echo "  test            - Run tests"
	@echo "  bench           - Run gas benchmark tests"
	@echo "  clean           - Clean build artifacts"
	@echo "  deploy-testnet  - Deploy to Stellar testnet"
	@echo "  deploy-mainnet  - Deploy to Stellar mainnet (with confirmation)"
	@echo "  init-contract   - Initialize deployed contract"
	@echo "  install-tools   - Install required tools"
	@echo "  setup-testnet   - Prepare local Soroban testnet tooling/profile"

# Contract release checklist
release-checklist:
	@echo "Release checklist: ../docs/RELEASE_CHECKLIST.md"
	@echo "Contract release steps:"
	@echo "  1) Build the WASM artifact with 'make build'"
	@echo "  2) Confirm the contract SBOM and attestation are present in CI"
	@echo "  3) Hand off backend deploy steps to the release owner"
	@echo "  4) Verify post-release health checks before closing the release"
