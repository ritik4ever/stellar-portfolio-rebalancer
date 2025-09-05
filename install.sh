#!/bin/bash

set -e

echo "Installing Stellar Portfolio Rebalancer..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check Node.js version
check_node() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18 or later."
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d 'v' -f 2)
    REQUIRED_VERSION="18.0.0"
    
    if ! node -p "process.version" | grep -q "v1[8-9]\|v[2-9][0-9]"; then
        print_error "Node.js version $NODE_VERSION is not supported. Please install Node.js 18 or later."
        exit 1
    fi
    
    print_status "Node.js version $NODE_VERSION is compatible"
}

# Check Rust installation
check_rust() {
    if ! command -v cargo &> /dev/null; then
        print_warning "Rust is not installed. Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source ~/.cargo/env
    fi
    
    # Add wasm32 target
    rustup target add wasm32-unknown-unknown
    
    print_status "Rust environment configured"
}

# Install dependencies
install_deps() {
    print_status "Installing root dependencies..."
    npm install
    
    print_status "Installing backend dependencies..."
    cd backend && npm install && cd ..
    
    print_status "Installing frontend dependencies..."
    cd frontend && npm install && cd ..
    
    print_status "Building contracts..."
    cd contracts && cargo check && cd ..
}

# Setup environment files
setup_env() {
    print_status "Setting up environment files..."
    
    if [ ! -f .env ]; then
        cp .env.example .env
    fi
    
    if [ ! -f frontend/.env ]; then
        cp frontend/.env.example frontend/.env
    fi
    
    if [ ! -f backend/.env ]; then
        cp backend/.env.example backend/.env
    fi
    
    print_warning "Please update the .env files with your configuration"
}

# Create necessary directories
create_dirs() {
    mkdir -p backend/logs
    mkdir -p deployment/ssl
    print_status "Created necessary directories"
}

# Main installation
main() {
    echo "🚀 Stellar Portfolio Rebalancer Installation"
    echo "============================================"
    
    check_node
    check_rust
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

main