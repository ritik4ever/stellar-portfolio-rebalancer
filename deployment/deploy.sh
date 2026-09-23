#!/bin/bash

set -euo pipefail

PRODUCTION_DEPLOY=false
DRY_RUN=false
HEALTH_URL="${DEPLOY_HEALTH_URL:-${HEALTH_CHECK_URL:-http://localhost:3001/health}}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-10}"
HEALTH_RETRIES="${DEPLOY_HEALTH_RETRIES:-5}"
HEALTH_INTERVAL="${DEPLOY_HEALTH_INTERVAL:-10}"
ROLLBACK_WINDOW_SECONDS="${DEPLOY_ROLLBACK_WINDOW:-300}"
ROLLBACK_COMMAND="${ROLLBACK_COMMAND:-}"
ALERT_COMMAND="${ALERT_COMMAND:-}"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.state}"
PREVIOUS_GOOD_FILE="${DEPLOY_STATE_DIR}/last-known-good"
DEPLOY_LOG_FILE="${DEPLOY_STATE_DIR}/deploy.log"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '#' | awk '/=/ {print $1}')
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    echo "Usage: $0 [--production] [--dry-run] [--health-url URL] [--health-timeout SECONDS] [--health-retries N] [--health-interval SECONDS] [--rollback-window SECONDS] [--rollback-command CMD] [--alert-command CMD]"
    echo ""
    echo "Examples:"
    echo "  $0 --production --health-url http://localhost:3001/health"
    echo "  $0 --production --dry-run --health-url http://localhost:3001/health"
}

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

log_event() {
    mkdir -p "${DEPLOY_STATE_DIR}"
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1" | tee -a "${DEPLOY_LOG_FILE}"
}

send_alert() {
    local message="$1"
    local severity="${2:-warning}"

    echo -e "${RED}ALERT [${severity}]:${NC} ${message}"

    if [ -n "${SLACK_WEBHOOK_URL}" ]; then
        local emoji="warning"
        if [ "${severity}" = "error" ]; then
            emoji="alert"
        fi
        curl -s -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"${emoji} ${message}\"}" \
            "${SLACK_WEBHOOK_URL}" || print_warning "Failed to send Slack notification"
    fi

    if [ -n "${ALERT_COMMAND}" ]; then
        if ! bash -lc "${ALERT_COMMAND} \"${message}\""; then
            print_warning "Alert command failed; continuing with deployment workflow."
        fi
    fi
}

save_previous_good_state() {
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        local ref
        ref="$(git rev-parse HEAD 2>/dev/null || echo "manual-deploy")"
        mkdir -p "${DEPLOY_STATE_DIR}"
        printf '%s\n' "${ref}" > "${PREVIOUS_GOOD_FILE}"
        log_event "Saved previous known-good deployment reference: ${ref}"
    fi
}

trigger_rollback() {
    local reason="$1"
    local age_seconds="$2"

    if [ "${DRY_RUN}" = "true" ]; then
        log_event "DRY-RUN: health check failed after ${age_seconds}s (${reason}). Rollback would be triggered to the previous known-good deployment."
        send_alert "Dry-run rollback would have been triggered after failed post-deploy health check (${reason})" "warning"
        return 0
    fi

    local effective_rollback_command="${ROLLBACK_COMMAND}"
    if [ -z "${effective_rollback_command}" ] && [ -f "${PREVIOUS_GOOD_FILE}" ]; then
        local previous_ref
        previous_ref="$(cat "${PREVIOUS_GOOD_FILE}")"
        effective_rollback_command="git checkout --detach ${previous_ref}"
    fi

    if [ -z "${effective_rollback_command}" ]; then
        print_error "Health check failed after ${age_seconds}s (${reason}) but no rollback command was configured."
        send_alert "Automated rollback skipped because no rollback command was configured after failed post-deploy health check (${reason})." "error"
        return 1
    fi

    send_alert "Automated rollback triggered after failed post-deploy health check (${reason})" "error"
    log_event "Executing rollback command: ${effective_rollback_command}"

    if bash -lc "${effective_rollback_command}"; then
        log_event "Rollback completed successfully."
        print_status "Rollback completed successfully."
        return 0
    fi

    print_error "Rollback command failed after health check failure."
    send_alert "Rollback command failed following failed post-deploy health check (${reason})." "error"
    return 1
}

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

    if ! command -v curl &> /dev/null; then
        print_error "curl is required for post-deploy health validation."
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        print_warning "Docker is not installed. Deployment to production will be limited."
    fi
}

health_check() {
    local url="$HEALTH_URL"
    local attempt=1
    local start_epoch
    start_epoch="$(date +%s)"

    print_info "Running health check against ${url} (max ${HEALTH_RETRIES} attempts, ${HEALTH_INTERVAL}s interval)..."

    if [ "$DRY_RUN" = true ]; then
        print_info "[DRY-RUN] Would poll ${url} up to ${HEALTH_RETRIES} times"
        return 1
    fi

    while [ "$attempt" -le "$HEALTH_RETRIES" ]; do
        if curl -sf --max-time "$HEALTH_TIMEOUT" "$url" > /dev/null 2>&1; then
            print_status "Health check passed on attempt ${attempt}"
            return 0
        fi

        if [ "$attempt" -lt "$HEALTH_RETRIES" ]; then
            print_warning "Health check failed (attempt ${attempt}/${HEALTH_RETRIES}), retrying in ${HEALTH_INTERVAL}s..."
            sleep "$HEALTH_INTERVAL"
        fi

        attempt=$((attempt + 1))
    done

    print_error "Health check failed after ${HEALTH_RETRIES} attempts (elapsed $(( $(date +%s) - start_epoch ))s)"
    return 1
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --production)
                PRODUCTION_DEPLOY=true
                ;;
            --dry-run)
                DRY_RUN=true
                ;;
            --health-url)
                [ "$#" -ge 2 ] || { print_error "Missing value for --health-url"; exit 1; }
                HEALTH_URL="$2"
                shift
                ;;
            --health-timeout)
                [ "$#" -ge 2 ] || { print_error "Missing value for --health-timeout"; exit 1; }
                HEALTH_TIMEOUT="$2"
                shift
                ;;
            --health-retries)
                [ "$#" -ge 2 ] || { print_error "Missing value for --health-retries"; exit 1; }
                HEALTH_RETRIES="$2"
                shift
                ;;
            --health-interval)
                [ "$#" -ge 2 ] || { print_error "Missing value for --health-interval"; exit 1; }
                HEALTH_INTERVAL="$2"
                shift
                ;;
            --rollback-window)
                [ "$#" -ge 2 ] || { print_error "Missing value for --rollback-window"; exit 1; }
                ROLLBACK_WINDOW_SECONDS="$2"
                shift
                ;;
            --rollback-command)
                [ "$#" -ge 2 ] || { print_error "Missing value for --rollback-command"; exit 1; }
                ROLLBACK_COMMAND="$2"
                shift
                ;;
            --alert-command)
                [ "$#" -ge 2 ] || { print_error "Missing value for --alert-command"; exit 1; }
                ALERT_COMMAND="$2"
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                print_error "Unknown argument: $1"
                usage
                exit 1
                ;;
        esac
        shift
    done
}

build_contracts() {
    print_status "Building smart contracts..."
    cd contracts

    cargo build --release

    if command -v soroban &> /dev/null; then
        soroban contract build
        print_status "Contract optimized with Soroban CLI"
    fi

    cd ..
}

deploy_contracts() {
    print_status "Deploying contracts to Stellar testnet..."
    cd contracts

    if [ -z "$STELLAR_SECRET_KEY" ]; then
        print_error "STELLAR_SECRET_KEY environment variable is required"
        exit 1
    fi

    if command -v soroban &> /dev/null; then
        CONTRACT_ID=$(soroban contract deploy \
            --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
            --source "$STELLAR_SECRET_KEY" \
            --network testnet)

        print_status "Contract deployed with ID: $CONTRACT_ID"

        REFLECTOR_ADDRESS="${REFLECTOR_ADDRESS:-CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO}"

        soroban contract invoke \
            --id "$CONTRACT_ID" \
            --source "$STELLAR_SECRET_KEY" \
            --network testnet \
            -- initialize \
            --admin "$(soroban keys address deployer)" \
            --reflector_address "$REFLECTOR_ADDRESS"

        print_status "Contract initialized"

        echo "VITE_CONTRACT_ADDRESS=$CONTRACT_ID" >> ../frontend/.env
        echo "CONTRACT_ADDRESS=$CONTRACT_ID" >> ../backend/.env
    else
        print_warning "Soroban CLI not found. Please deploy manually."
    fi

    cd ..
}

build_frontend() {
    print_status "Building frontend..."
    cd frontend
    npm install
    npm run build
    cd ..
}

build_backend() {
    print_status "Building backend..."
    cd backend
    npm install
    npm run build
    cd ..
}

deploy_production() {
    if [ "${PRODUCTION_DEPLOY}" != "true" ] && [ "${DRY_RUN}" != "true" ]; then
        return 0
    fi

    if [ "${DRY_RUN}" = "true" ]; then
        print_info "==========================================="
        print_info "  DRY-RUN MODE: no actual changes will be made"
        print_info "==========================================="
        print_status "DRY-RUN: production deployment validated without executing docker compose up."
        print_status "Health URL: ${HEALTH_URL}"
        return 0
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
    ${COMPOSE_CMD} -f deployment/docker-compose.yml config > /dev/null

    local deployment_start
    deployment_start="$(date +%s)"
    ${COMPOSE_CMD} -f deployment/docker-compose.yml up --build -d

    if ! health_check; then
        local elapsed_seconds=$(( $(date +%s) - deployment_start ))

        if [ "${elapsed_seconds}" -le "${ROLLBACK_WINDOW_SECONDS}" ]; then
            print_warning "Health check failed within rollback window (${elapsed_seconds}s <= ${ROLLBACK_WINDOW_SECONDS}s). Triggering rollback..."
            if ! trigger_rollback "post-deploy health check failed" "${elapsed_seconds}"; then
                print_error "Deployment failed and rollback could not be completed."
                exit 1
            fi
        else
            print_warning "Health check failed outside rollback window (${elapsed_seconds}s > ${ROLLBACK_WINDOW_SECONDS}s). Keeping deployment for manual review."
            send_alert "Health check failed outside rollback window; manual review required." "warning"
            exit 1
        fi
    fi

    print_status "Production deployment completed!"
    print_status "Frontend: http://localhost:3000"
    print_status "Backend API: http://localhost:3001/api"
}

main() {
    parse_args "$@"

    echo "🌟 Stellar Portfolio Rebalancer Deployment Script"
    echo "================================================"

    if [ "${DRY_RUN}" = "true" ]; then
        print_status "Dry-run mode enabled; no live deployment or rollback will execute."
        save_previous_good_state
        print_status "DRY-RUN: production deployment validated without executing docker compose up."
        print_status "Health URL: ${HEALTH_URL}"
        return 0
    fi

    save_previous_good_state
    check_dependencies
    build_contracts

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

    if [ "${PRODUCTION_DEPLOY}" = "true" ]; then
        print_status "Production:"
        print_status "  Application: http://localhost"
    fi
}

main "$@"
