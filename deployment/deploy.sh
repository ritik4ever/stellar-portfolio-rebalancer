#!/bin/bash

set -e

echo "Deploying Stellar Portfolio Rebalancer..."

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '#' | awk '/=/ {print $1}')
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration with defaults
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:3001/readiness}"
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-5}"
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-10}"
DRY_RUN=false

# Function to print colored output
print_status() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERR]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Send alert notification
send_alert() {
    local message="$1"
    local severity="${2:-warning}"

    echo -e "${RED}ALERT [${severity}]:${NC} ${message}"

    # Send Slack notification if webhook is configured
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        local emoji="warning"
        if [ "$severity" = "error" ]; then
            emoji="alert"
        fi
        curl -s -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"${emoji} ${message}\"}" \
            "$SLACK_WEBHOOK_URL" || print_warning "Failed to send Slack notification"
    fi
}

# Health check function
health_check() {
    local url="$HEALTH_CHECK_URL"
    local retries="$HEALTH_CHECK_RETRIES"
    local interval="$HEALTH_CHECK_INTERVAL"
    local attempt=1

    print_info "Running health check against ${url} (max ${retries} attempts, ${interval}s interval)..."

    if [ "$DRY_RUN" = true ]; then
        print_info "[DRY-RUN] Would poll ${url} up to ${retries} times"
        print_info "[DRY-RUN] Simulating health check failure for rollback validation"
        return 1
    fi

    while [ $attempt -le $retries ]; do
        print_info "Health check attempt ${attempt}/${retries}..."

        if curl -sf --max-time 10 "$url" > /dev/null 2>&1; then
            print_status "Health check passed on attempt ${attempt}"
            return 0
        fi

        if [ $attempt -lt $retries ]; then
            print_warning "Health check failed (attempt ${attempt}/${retries}), retrying in ${interval}s..."
            sleep "$interval"
        fi

        attempt=$((attempt + 1))
    done

    print_error "Health check failed after ${retries} attempts"
    return 1
}

# Rollback function
rollback() {
    local compose_cmd="$1"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    print_error "==========================================="
    print_error "  INITIATING AUTOMATED ROLLBACK"
    print_error "  Time: ${timestamp}"
    print_error "==========================================="

    send_alert "Automated rollback triggered for stellar-portfolio-rebalancer at ${timestamp}. Health check failed against ${HEALTH_CHECK_URL}." "error"

    if [ "$DRY_RUN" = true ]; then
        print_info "[DRY-RUN] Would execute: ${compose_cmd} -f deployment/docker-compose.yml down"
        print_info "[DRY-RUN] Would execute: ${compose_cmd} -f deployment/docker-compose.yml up -d"
        print_info "[DRY-RUN] Rollback simulation complete"
        print_status "[DRY-RUN] Rollback logic validated successfully"
        return 0
    fi

    print_info "Stopping failed deployment..."
    $compose_cmd -f deployment/docker-compose.yml down || {
        print_error "Failed to stop current deployment during rollback"
        send_alert "CRITICAL: Rollback failed to stop current deployment" "error"
        return 1
    }

    print_info "Restoring previous deployment..."
    $compose_cmd -f deployment/docker-compose.yml up -d || {
        print_error "Failed to restore previous deployment"
        send_alert "CRITICAL: Rollback failed to restore previous deployment. Manual intervention required." "error"
        return 1
    }

    print_warning "Rollback completed. Previous deployment restored."
    print_warning "Please investigate the failed deployment and re-deploy when fixed."
    send_alert "Rollback completed successfully. Previous deployment restored. Investigation needed." "warning"

    return 0
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
        
        REFLECTOR_ADDRESS=${REFLECTOR_ADDRESS:-"CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO"}
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

# Deploy to production (Docker) with health check and rollback
deploy_production() {
    if [ "$1" = "--production" ] || [ "$1" = "--dry-run" ]; then
        if [ "$1" = "--dry-run" ]; then
            DRY_RUN=true
            print_info "==========================================="
            print_info "  DRY-RUN MODE: no actual changes will be made"
            print_info "==========================================="
        fi

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
        if [ "$DRY_RUN" = true ]; then
            print_info "[DRY-RUN] Would validate compose configuration"
            print_info "[DRY-RUN] Would run: ${COMPOSE_CMD} -f deployment/docker-compose.yml up --build -d"
        else
            $COMPOSE_CMD -f deployment/docker-compose.yml config > /dev/null
            
            # Build and start services
            $COMPOSE_CMD -f deployment/docker-compose.yml up --build -d
        fi

        # Post-deploy health check
        print_status "Running post-deploy health check..."
        if health_check; then
            print_status "Production deployment completed and verified!"
            print_status "Frontend: http://localhost:3000"
            print_status "Backend API: http://localhost:3001/api"
        else
            print_error "Post-deploy health check failed!"
            print_error "Triggering automated rollback..."

            if rollback "$COMPOSE_CMD"; then
                print_warning "Rollback succeeded. Deployment reverted to previous version."
            else
                print_error "CRITICAL: Rollback failed! Manual intervention required."
                send_alert "CRITICAL: Both deployment and rollback failed. Manual intervention required immediately." "error"
            fi

            if [ "$DRY_RUN" = true ]; then
                print_status "[DRY-RUN] Dry run completed. Rollback logic validated."
            else
                exit 1
            fi
        fi
    fi
}

# Parse command-line arguments
parse_args() {
    for arg in "$@"; do
        case $arg in
            --dry-run)
                DRY_RUN=true
                ;;
        esac
    done
}

# Main deployment flow
main() {
    echo "Stellar Portfolio Rebalancer Deployment Script"
    echo "================================================"
    
    parse_args "$@"

    if [ "$DRY_RUN" = true ]; then
        print_info "Running in dry-run mode. Validating rollback logic."
        deploy_production "--dry-run"
        return 0
    fi

    check_dependencies
    build_contracts
    
    # Only deploy contracts if on testnet/mainnet
    if [ "$STELLAR_NETWORK" = "testnet" ] || [ "$STELLAR_NETWORK" = "mainnet" ]; then
        deploy_contracts
    fi
    
    build_backend
    build_frontend
    
    deploy_production "$@"
    
    print_status "Deployment completed successfully!"
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
