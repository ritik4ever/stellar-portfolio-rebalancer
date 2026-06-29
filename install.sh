#!/usr/bin/env bash

set -euo pipefail

echo "Installing Stellar Portfolio Rebalancer..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

REQUIRED_NODE_VERSION="20.19.0"
REQUIRED_NPM_VERSION="10.0.0"

print_status() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

fail() {
    print_error "$1"
    exit 1
}

require_command() {
    local command_name="$1"
    local install_hint="$2"

    if ! command -v "${command_name}" >/dev/null 2>&1; then
        fail "${command_name} is required but was not found. ${install_hint}"
    fi
}

version_at_least() {
    local actual="$1"
    local required="$2"

    node -e "
const actual = process.argv[1].split('.').map(Number);
const required = process.argv[2].split('.').map(Number);
for (let i = 0; i < 3; i += 1) {
  if ((actual[i] || 0) > (required[i] || 0)) process.exit(0);
  if ((actual[i] || 0) < (required[i] || 0)) process.exit(1);
}
process.exit(0);
" "${actual}" "${required}"
}

run_step() {
    local description="$1"
    shift

    print_status "${description}"
    "$@" || fail "${description} failed. Review the command output above and try again."
}

run_npm_install() {
    local directory="$1"
    local label="$2"

    print_status "Installing ${label} dependencies..."
    (
        cd "${directory}"
        npm install
    ) || fail "npm install failed for ${label} dependencies."
}

# Check Node.js and npm versions.
check_node() {
    require_command "node" "Install Node.js ${REQUIRED_NODE_VERSION} or later: https://nodejs.org/"
    require_command "npm" "Install npm ${REQUIRED_NPM_VERSION} or later. It is bundled with supported Node.js releases."

    local node_version
    node_version="$(node -p "process.versions.node")"
    if ! version_at_least "${node_version}" "${REQUIRED_NODE_VERSION}"; then
        fail "Node.js ${node_version} is not supported. Please install Node.js ${REQUIRED_NODE_VERSION} or later."
    fi

    local npm_version
    npm_version="$(npm -v)"
    if ! version_at_least "${npm_version}" "${REQUIRED_NPM_VERSION}"; then
        fail "npm ${npm_version} is not supported. Please install npm ${REQUIRED_NPM_VERSION} or later."
    fi

    print_status "Node.js ${node_version} and npm ${npm_version} are compatible"
}

# Check Rust toolchain and required WebAssembly target.
check_rust() {
    require_command "rustc" "Install Rust with rustup: https://rustup.rs/"
    require_command "cargo" "Install Rust with rustup: https://rustup.rs/"
    require_command "rustup" "Install Rust with rustup so targets can be managed: https://rustup.rs/"

    local rustc_version
    rustc_version="$(rustc --version)"
    local cargo_version
    cargo_version="$(cargo --version)"

    if ! rustup target list --installed | grep -qx "wasm32-unknown-unknown"; then
        run_step "Installing Rust wasm32-unknown-unknown target" rustup target add wasm32-unknown-unknown
    fi

    print_status "Rust toolchain detected (${rustc_version}; ${cargo_version})"
}

# Check Soroban CLI.
check_soroban() {
    require_command "soroban" "Install it with: cargo install --locked soroban-cli"

    local soroban_version
    soroban_version="$(soroban --version)"
    print_status "Soroban CLI detected (${soroban_version})"
}

# Install dependencies.
install_deps() {
    run_npm_install "." "root"
    run_npm_install "backend" "backend"
    run_npm_install "frontend" "frontend"

    run_step "Checking contracts" bash -c "cd contracts && cargo check"
}

# Setup environment files.
copy_env_if_available() {
    local source_file="$1"
    local target_file="$2"

    if [ -f "${target_file}" ]; then
        return
    fi

    if [ -f "${source_file}" ]; then
        cp "${source_file}" "${target_file}"
        print_status "Created ${target_file}"
    else
        print_warning "Skipped ${target_file}; ${source_file} does not exist"
    fi
}

setup_env() {
    print_status "Setting up environment files..."

    copy_env_if_available ".env.example" ".env"
    copy_env_if_available "frontend/.env.example" "frontend/.env"
    copy_env_if_available "backend/.env.example" "backend/.env"

    print_warning "Please update the .env files with your configuration"
}

# Create necessary directories.
create_dirs() {
    mkdir -p backend/logs
    mkdir -p deployment/ssl
    print_status "Created necessary directories"
}

# Main installation.
main() {
    echo "Stellar Portfolio Rebalancer Installation"
    echo "========================================="

    check_node
    check_rust
    check_soroban
    install_deps
    setup_env
    create_dirs

    print_status "Installation completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Update environment files (.env, frontend/.env, backend/.env)"
    echo "2. Run 'npm run dev' to start development servers"
    echo "3. Visit http://localhost:3000 to view the application"
}

main "$@"
