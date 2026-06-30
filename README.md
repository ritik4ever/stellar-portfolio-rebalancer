# Stellar Portfolio Rebalancer

[![GitHub Repo](https://img.shields.io/badge/repo-Stellar%20Portfolio%20Rebalancer-blue?style=flat-square)](https://github.com/ritik4ever/stellar-portfolio-rebalancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview

Stellar Portfolio Rebalancer is an **intelligent DeFi portfolio management platform** built on Stellar that automatically rebalances crypto portfolios using real-time price data from Reflector oracles.  

It helps users maintain optimal asset allocation through automated rebalancing triggered by configurable drift thresholds while leveraging Stellar's fast, low-cost infrastructure.

---

## Features

* **Smart Rebalancing** – Automatic maintenance of target allocations based on threshold triggers.
* **Multi-Wallet Support** – Compatible with Freighter, Rabet, xBull, and other Stellar wallets.
* **Real-Time Price Feeds** – Powered by Reflector oracles with API fallbacks.
* **Risk Management** – Circuit breakers, concentration limits, and volatility detection.
* **Professional UI** – Responsive interface with real-time portfolio visualization.
* **Demo Mode** – $10,000 simulated portfolio for testing.
* **Trust & Transparency** – Landing page summarizes architecture, risk controls, and observability; legal documents show a fixed version and effective date.

---

## Project Roadmap

See where the Stellar Portfolio Rebalancer is headed!

| **Now** (Current Sprint) | **Next** (1-2 months) | **Later** (3-6+ months) |
| :--- | :--- | :--- |
| Core rebalancing algorithm | Portfolio dashboard | Mobile app |
| Reflector oracle integration | Historical reports | Custom strategies |
| Wallet connection stability | Notification system | DeFi integration |
| Bug fixes | Multi-asset support | Tax optimization |

**[View detailed roadmap →](docs/ROADMAP.md)**

---

## Architecture

```text
stellar-portfolio-rebalancer/
├── contracts/     # Soroban smart contracts
├── frontend/      # React + TypeScript frontend
├── backend/       # Node.js + Express API
├── deployment/    # Docker deployment files
└── docs/          # Documentation (including ADRs)

Core Terms
New contributors should read the glossary before deeper setup or contract work.

Portfolio: The user-managed allocation object tracked by portfolio_id.

Target Allocation, Rebalance Threshold, & Slippage Tolerance: The main contract parameters for automated rebalancing.

Reflector Oracle: The price source used by the contract for drift and rebalance decisioning.

Cooldown Period & Emergency Stop: Built-in safety controls for rebalances.

📘 Glossary Access: See docs/GLOSSARY.md for the central glossary and cross-links to contract, API, and deployment docs.

Tech Stack
Layer: Technology

Smart Contracts: Rust + Soroban

Frontend: React + TypeScript + Tailwind CSS

Backend: Node.js + Express + TypeScript

Price Data: Reflector + CoinGecko API



Quick Start
Prerequisites
Node.js >=20.19.0

Rust + Cargo

Soroban CLI

Stellar wallet (Freighter or Rabet recommended)

Installation
Bash
# Clone the repository
git clone [https://github.com/ritik4ever/stellar-portfolio-rebalancer.git](https://github.com/ritik4ever/stellar-portfolio-rebalancer.git)
cd stellar-portfolio-rebalancer

# Frontend Setup
cd frontend
npm install

# Backend Setup
cd ../backend
npm install

# Smart Contracts Setup
cd ../contracts
cargo build

Environment Setup
Bash
# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env
Edit the .env files with your own configuration (contract addresses, API keys, etc.).

Environment Reference: Full backend environment reference can be found at docs/ENVIRONMENT.md.

API Versioning: The frontend HTTP client targets /api/v1/* for resource routes by default (VITE_API_VERSION=v1 in frontend/.env.example). JWT auth still uses /api/auth/*. See API.md for complete versioning details.

API Client Examples: Check out the Python API Client Example (or corresponding examples file).

Database Setup
PostgreSQL migrations are available for environments configured with DATABASE_URL or the PGHOST / PGDATABASE / PGUSER variables.

Bash
cd backend
npm run db:migrate                 # Apply migrations
npm run db:migrate -- --dry-run   # Preview migrations
Local Development: For local SQLite development, leave PostgreSQL variables unset and use DB_PATH instead. The default path is backend/data/portfolio.db. The backend creates the database file plus its parent directory automatically on startup. Fresh clones should not include any prebuilt .db, .db-wal, or .db-shm files.

Demo Seeding: SQLite demo data appears only when demo seeding is enabled through ENABLE_DEMO_DB_SEED or via Demo Mode. Otherwise, the local database starts empty and bootstraps from the checked-in schema and seed sources.

Email Notifications (Optional)
Gmail Config Example:

Code snippet
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
Other supported providers include SendGrid, Mailgun, and AWS SES.

Test Notifications:

Bash
curl -X POST http://localhost:3001/api/v1/notifications/test \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_STELLAR_ADDRESS", "eventType": "rebalance"}'

Development
Start your local development servers:

Terminal 1 - Backend:

Bash
cd backend
npm run dev

Terminal 2 - Frontend:

Bash
cd frontend
npm run dev

Frontend Local URL: http://localhost:3000

Backend API Local URL: http://localhost:3001

Smart Contract Deployment
Bash
cd contracts

# Build contract
soroban contract build

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source deployer \
  --network testnet

# Initialize contract
soroban contract invoke \
  --id YOUR_CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin YOUR_ADMIN_ADDRESS \
  --reflector_address CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO
Contract Address Example: CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I

WASM Hash Verification
Before deploying, you can compute and audit the canonical SHA-256 hash of the compiled WASM contract to ensure reproducibility and security:

Bash
cd contracts
make hash
This target outputs the hash of both the release WASM and the optimized WASM (if available). The same hash calculation runs automatically on release/PR builds to simplify deployment audits.

Developer Resources:

Contract interface reference (functions, errors, type notes): contracts/CONTRACT_ABI.md

Common Soroban invoke commands and examples: docs/soroban-cookbook.md

Frontend compatibility & capability matrix (degradation mapping): docs/CONTRACT_CAPABILITY_MATRIX.md

Usage
📸 New to the platform? Check out our Visual Demo Walkthrough with step-by-step screenshots and detailed explanations.

Quick Start Workflow
Connect your Stellar wallet.

Create a portfolio and set target allocations (sum must equal 100%, maximum 10 assets per portfolio).

Configure rebalance thresholds (1–50%).

Enable/disable automatic rebalancing.

Submit transaction.

Managing Portfolios
Dashboard: View current allocations and performance.

Rebalancing: Manual or automatic execution.

History: Track past rebalances.

Portfolio Asset Limit
Each portfolio supports a maximum of 10 assets (MAX_PORTFOLIO_ASSETS). This limit exists because Soroban persistent storage entries are bounded by ledger entry size constraints; each asset adds allocation and balance map entries plus oracle lookup overhead during rebalance. Attempting to create a portfolio with more than 10 assets returns a TooManyAssets error.

Safety Features
Cooldown Periods: Minimum 1 hour between rebalances.

Volatility Detection: Pauses rebalancing during extreme market conditions.

Concentration Limits: Prevents over-allocation to single assets.

Circuit Breakers: Multiple safety checks before executing trades.

Notifications
Email and Webhook notifications for rebalancing events.

Event types: rebalance, circuit breaker, price movement, risk changes.

Configurable per user.

API Reference
Canonical: /api/v1/*

Legacy (Deprecated): /api/*
# Create portfolio
POST /api/v1/portfolio
Content-Type: application/json
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

# Subscribe to notifications
POST /api/v1/notifications/subscribe

# Get preferences
GET /api/v1/notifications/preferences?userId=STELLAR_ADDRESS

# Unsubscribe from notifications
DELETE /api/v1/notifications/unsubscribe?userId=STELLAR_ADDRESS

# Price Data Feeds
GET /api/v1/prices
GET /api/v1/portfolio/:id/rebalance-plan

Stellar DEX Integration
Real trades executed on Stellar testnet using @stellar/stellar-sdk.

Slippage-aware execution, partial fills, and automated rollback handling.

Rebalance history tracks outcomes and explicit slippage metrics.

Testing
Bash
# Frontend tests
cd frontend && npm test

# Backend tests
cd backend && npm test

# Smart contract tests
cd contracts && cargo test

# Smart contract gas benchmarks
cd contracts && make bench

Docker Deployment
Bash
docker compose -f deployment/docker-compose.yml config
docker compose -f deployment/docker-compose.yml build frontend backend
docker compose -f deployment/docker-compose.yml up --build -d

Contributing
See CONTRIBUTING.md for the canonical contributor guide. It includes minimum local setup, optional services (Redis, PostgreSQL, SMTP), test commands, API doc generation, queue worker expectations, and frontend E2E setup.

System Workflows: For Windows and WSL users, see the Windows/WSL Local Development Workflow (or appropriate documentation link).

Issue Management: For issue management, triage definitions (P0-P3), and PR rules, see the Backlog Grooming Guide.

PR Requirement: Pull Requests must explicitly link to an open issue, or provide a detailed rationale when no issue exists. A block-level CI check strictly enforces this rule.

Quick Steps to Contribute:
Fork the repository.

Create a feature branch: git checkout -b feature/awesome-feature.

Follow the setup instructions in docs/CONTRIBUTING.md.

Ensure all local tests pass: cd backend && npm test && cd ../frontend && npm test.

Open a well-documented Pull Request.

Troubleshooting
Wallet Issues
Having trouble connecting your Stellar wallet? See the Wallet Troubleshooting FAQ for step-by-step fixes for:

"Wallet is not installed" errors

Connection timeouts and declines

Transaction signing failures

Network mismatch between wallet and app

Wallet-specific quirks (Freighter, Rabet, xBull)

Common Setup Issues
See CONTRIBUTING.md §10 "Common setup failures" for backend, database, and environment issues.

License
This project is licensed under the MIT License.

Acknowledgments
Stellar Development Foundation

Reflector Protocol

Soroban

Community wallet integrations

Built with ❤️ for the Stellar ecosystem