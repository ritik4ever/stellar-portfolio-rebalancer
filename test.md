## REAME FILE
Overview

Stellar Portfolio Rebalancer is an intelligent DeFi portfolio management platform built on Stellar that automatically rebalances crypto portfolios using real-time price data from Reflector oracles.

It helps users maintain optimal asset allocation through automated rebalancing triggered by configurable drift thresholds while leveraging Stellar's fast, low-cost infrastructure.
Features

    Smart Rebalancing – Automatic maintenance of target allocations based on threshold triggers
    Multi-Wallet Support – Compatible with Freighter, Rabet, xBull, and other Stellar wallets
    Real-Time Price Feeds – Powered by Reflector oracles with API fallbacks
    Risk Management – Circuit breakers, concentration limits, volatility detection
    Professional UI – Responsive interface with real-time portfolio visualization
    Demo Mode – $10,000 simulated portfolio for testing

Architecture

stellar-portfolio-rebalancer/
├── contracts/     # Soroban smart contracts
├── frontend/      # React + TypeScript frontend
├── backend/       # Node.js + Express API
├── deployment/    # Docker deployment files
└── docs/          # Documentation

Tech Stack
Layer 	Technology
Smart Contracts 	Rust + Soroban
Frontend 	React + TypeScript + Tailwind CSS
Backend 	Node.js + Express + TypeScript
Price Data 	Reflector + CoinGecko API
Blockchain 	Stellar Testnet
Quick Start
Prerequisites

    Node.js 18+
    Rust + Cargo
    Soroban CLI
    Stellar wallet (Freighter or Rabet recommended)

Installation

# Clone the repository
git clone https://github.com/ritik4ever/stellar-portfolio-rebalancer.git
cd stellar-portfolio-rebalancer

# Frontend
cd frontend
npm install

# Backend
cd ../backend
npm install

# Smart Contracts
cd ../contracts
cargo build

Environment Setup

# Backend
cp backend/.env.example backend/.env
# Frontend
cp frontend/.env.example frontend/.env

    Edit .env files with your own configuration (contract addresses, API keys, etc.)

Full backend environment reference: docs/ENVIRONMENT.md

API Client Examples: Python API Client Example

The frontend HTTP client targets /api/v1/* for resource routes by default (VITE_API_VERSION=v1 in frontend/.env.example). JWT auth still uses /api/auth/*. See API.md for versioning details.
Database Setup

PostgreSQL migrations are available for environments configured with DATABASE_URL or the PGHOST / PGDATABASE / PGUSER variables.

cd backend
npm run db:migrate       # Apply migrations
npm run db:migrate -- --dry-run   # Preview migrations

For local SQLite development, leave PostgreSQL unset and use DB_PATH instead. The default path is backend/data/portfolio.db, and the backend creates the database file plus its parent directory automatically on startup. Fresh clones should not include any prebuilt .db, .db-wal, or .db-shm files.

SQLite demo data appears only when demo seeding is enabled through ENABLE_DEMO_DB_SEED or demo mode. Otherwise, the local database starts empty and bootstraps from the checked-in schema and seed sources.
Email Notifications (Optional)

Gmail Example:

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com

Other providers: SendGrid, Mailgun, AWS SES.

Test Notifications:

curl -X POST http://localhost:3001/api/v1/notifications/test \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_STELLAR_ADDRESS", "eventType": "rebalance"}'

Development

Start development servers:

# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev

    Frontend: http://localhost:3000

    Backend API: http://localhost:3001

Smart Contract Deployment

cd contracts

# Build
soroban contract build

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source deployer \
  --network testnet

# Initialize
soroban contract invoke \
  --id YOUR_CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin YOUR_ADMIN_ADDRESS \
  --reflector_address CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO

Contract address example: CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I

Contract interface reference (functions, errors, and type notes): contracts/CONTRACT_ABI.md Common Soroban invoke commands and examples: docs/soroban-cookbook.md
Usage

    Connect your Stellar wallet
    Create a portfolio and set target allocations (sum must equal 100%, maximum 10 assets per portfolio)
    Configure rebalance thresholds (1–50%)
    Enable/disable automatic rebalancing
    Submit transaction

Managing Portfolios

    Dashboard: View current allocations and performance
    Rebalancing: Manual or automatic execution
    History: Track past rebalances

Portfolio Asset Limit

Each portfolio supports a maximum of 10 assets (). This limit exists because Soroban persistent storage entries are bounded by ledger entry size constraints, and each asset adds allocation and balance map entries plus oracle lookup overhead during rebalance. Attempting to create a portfolio with more than 10 assets returns a error.
Safety Features

    Cooldown Periods: Minimum 1 hour between rebalances
    Volatility Detection: Pauses rebalancing during extreme market conditions
    Concentration Limits: Prevents over-allocation to single assets
    Circuit Breakers: Multiple safety checks before executing trades

Notifications

    Email and Webhook notifications for rebalancing events
    Event types: rebalance, circuit breaker, price movement, risk changes
    Configurable per user

API Reference Canonical: /api/v1/* Legacy (deprecated): /api/*

# Create portfolio
POST /api/v1/portfolio
{
  "userAddress": "STELLAR_ADDRESS",
  "allocations": {"XLM": 40, "USDC": 35, "BTC": 25},
  "threshold": 5
}

# Get portfolio
GET /api/v1/portfolio/:id

# Execute rebalance
POST /api/v1/portfolio/:id/rebalance

# Rebalance status
GET /api/v1/portfolio/:id/rebalance-status

Notifications:

# Subscribe
POST /api/v1/notifications/subscribe
# Get preferences
GET /api/v1/notifications/preferences?userId=STELLAR_ADDRESS
# Unsubscribe
DELETE /api/v1/notifications/unsubscribe?userId=STELLAR_ADDRESS

Price Data:

GET /api/v1/prices
GET /api/v1/portfolio/:id/rebalance-plan

Stellar DEX Integration

    Real trades on Stellar testnet using @stellar/stellar-sdk
    Slippage-aware execution, partial fills, and rollback handling
    Rebalance history tracks outcomes and slippage metrics

Testing

# Frontend
cd frontend && npm test

# Backend
cd backend && npm test

# Smart contracts
cd contracts && cargo test

# Smart contract gas benchmarks
cd contracts && make bench

Docker Deployment

docker compose -f deployment/docker-compose.yml config
docker compose -f deployment/docker-compose.yml build frontend backend
docker compose -f deployment/docker-compose.yml up --build -d

## TASK TO IMPLEMENT

#569 Create wallet-specific bug report template
Repo Avatar ritik4ever/stellar-portfolio-rebalancer

Wallet-related bugs often need different reproduction details than generic frontend issues.

Category: docs
Project area: .github, frontend/src/components/WalletSelector.tsx, docs/CONTRIBUTING.md

Implementation:

    Review the current documentation or contributor flow in .github, frontend/src/components/WalletSelector.tsx, docs/CONTRIBUTING.md.
    Add a focused bug template for wallet issues that asks for wallet type, browser, network, and signature behavior details.
    Add examples, cross-links, and maintenance notes so the documentation stays useful over time.

Acceptance Criteria:

    The new guidance is easy to discover from the main contributor path.
    Examples match the current codebase and terminology.
    Readers can complete the documented workflow without reading source first.

## MY PROFILE

I am working on a project with a team of software engineers on an open source project. I want you to take the role of a web developer with more than 15 years of experience to help me on my assingment that is required for the project. You are to execute only what required in this assignment of this project. You must provide a step-by-step process for me to test that i have successfully completed my assignment. Remember, you a web developer with more than 15 years of experience so as to help me on my assingment that is required for the project and you are to execute only what required in this assignment of this project.

