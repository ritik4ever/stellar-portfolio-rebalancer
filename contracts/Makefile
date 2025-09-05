# Stellar Portfolio Rebalancer Contract Makefile

.PHONY: build test clean deploy-testnet deploy-mainnet

# Default target
all: build

# Build the contract
build:
	cargo build --target wasm32-unknown-unknown --release

# Build with optimization
build-optimized:
	cargo build --target wasm32-unknown-unknown --release
	@if command -v soroban >/dev/null 2>&1; then \
		soroban contract optimize --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm; \
	else \
		echo "Soroban CLI not found. Install it for optimization."; \
	fi

# Run tests
test:
	cargo test

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

# Help target
help:
	@echo "Available targets:"
	@echo "  build           - Build the contract"
	@echo "  build-optimized - Build with optimization"
	@echo "  test            - Run tests"
	@echo "  clean           - Clean build artifacts"
	@echo "  deploy-testnet  - Deploy to Stellar testnet"
	@echo "  deploy-mainnet  - Deploy to Stellar mainnet (with confirmation)"
	@echo "  init-contract   - Initialize deployed contract"
	@echo "  install-tools   - Install required tools"
	@echo "  help            - Show this help message"