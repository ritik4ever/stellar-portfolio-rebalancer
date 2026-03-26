#!/bin/bash

set -e

echo "🚀 Deploying Stellar Portfolio Rebalancer..."

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '#' | awk '/=/ {print $1}')
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if required tools are installed
check_dependencies() {
    print_status "Checking dependencies..."
    
    if ! command -v cargo &> /dev/null; then
        print_error "Cargo is not installed. Please install Rust and Cargo."
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed."
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed."
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        print_warning "Docker is not installed. Deployment to production will be limited."
    fi
}

# Build smart contracts
build_contracts() {
    print_status "Building smart contracts..."
    cd contracts
    
    cargo build --release
    
    # If soroban CLI is available, optimize the contract
    if command -v soroban &> /dev/null; then
        soroban contract build
        print_status "Contract optimized with Soroban CLI"
    fi
    
    cd ..
}

# Deploy contracts to testnet
deploy_contracts() {
    print_status "Deploying contracts to Stellar testnet..."
    cd contracts
    
    if [ -z "$STELLAR_SECRET_KEY" ]; then
        print_error "STELLAR_SECRET_KEY environment variable is required"
        exit 1
    fi
    
    # Deploy using soroban CLI if available
    if command -v soroban &> /dev/null; then
        # Deploy the contract
        CONTRACT_ID=$(soroban contract deploy \
            --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
            --source $STELLAR_SECRET_KEY \
            --network testnet)
        
        print_status "Contract deployed with ID: $CONTRACT_ID"
        
        # Initialize the contract
        soroban contract invoke \
            --id $CONTRACT_ID \
            --source $STELLAR_SECRET_KEY \
            --network testnet \
            -- initialize \
            --admin $(soroban keys address deployer) \
            --reflector_address $REFLECTOR_ADDRESS
            
        print_status "Contract initialized"
        
        # Save contract ID to .env files
        echo "VITE_CONTRACT_ADDRESS=$CONTRACT_ID" >> ../frontend/.env
        echo "CONTRACT_ADDRESS=$CONTRACT_ID" >> ../backend/.env
        
    else
        print_warning "Soroban CLI not found. Please deploy manually."
    fi
    
    cd ..
}

# Build frontend
build_frontend() {
    print_status "Building frontend..."
    cd frontend
    npm install
    npm run build
    cd ..
}

# Build backend
build_backend() {
    print_status "Building backend..."
    cd backend
    npm install
    npm run build
    cd ..
}

# Deploy to production (Docker)
deploy_production() {
    if [ "$1" = "--production" ]; then
        print_status "Deploying to production..."
        
        if command -v docker &> /dev/null && docker compose version &> /dev/null; then
            COMPOSE_CMD="docker compose"
        elif command -v docker-compose &> /dev/null; then
            COMPOSE_CMD="docker-compose"
        else
            print_error "Neither docker compose plugin nor docker-compose is installed"
            exit 1
        fi

        print_status "Validating compose configuration..."
        $COMPOSE_CMD -f deployment/docker-compose.yml config > /dev/null
        
        # Build and start services
        $COMPOSE_CMD -f deployment/docker-compose.yml up --build -d
        
        print_status "Production deployment completed!"
        print_status "Frontend: http://localhost:3000"
        print_status "Backend API: http://localhost:3001/api"
    fi
}

# Main deployment flow
main() {
    echo "🌟 Stellar Portfolio Rebalancer Deployment Script"
    echo "================================================"
    
    check_dependencies
    build_contracts
    
    # Only deploy contracts if on testnet/mainnet
    if [ "$STELLAR_NETWORK" = "testnet" ] || [ "$STELLAR_NETWORK" = "mainnet" ]; then
        deploy_contracts
    fi
    
    build_backend
    build_frontend
    
    deploy_production "$@"
    
    print_status "Deployment completed successfully! 🎉"
    print_status "Local development:"
    print_status "  Frontend: http://localhost:3000"
    print_status "  Backend: http://localhost:3001"
    
    if [ "$1" = "--production" ]; then
        print_status "Production:"
        print_status "  Application: http://localhost"
    fi
}

# Run main function with all arguments
main "$@"
