markdown# Stellar Portfolio Rebalancer

An intelligent DeFi portfolio management platform built on Stellar that automatically rebalances crypto portfolios using real-time price data from Reflector oracles.

## Overview

The Stellar Portfolio Rebalancer helps users maintain optimal asset allocation through automated rebalancing triggered by configurable drift thresholds. It combines Stellar's fast, low-cost infrastructure with Reflector's decentralized price feeds to provide enterprise-grade portfolio management for retail users.

## Features

- **Smart Rebalancing**: Automatically maintains target allocations with intelligent threshold-based triggers
- **Multi-Wallet Support**: Compatible with Freighter, Rabet, xBull, and other Stellar wallets
- **Real-time Price Feeds**: Powered by Reflector oracles with external API fallbacks
- **Risk Management**: Built-in circuit breakers, concentration limits, and volatility detection
- **Professional UI**: Modern, responsive interface with real-time portfolio visualization
- **Demo Mode**: $10,000 simulated portfolio for testing and demonstrations

## Architecture
stellar-portfolio-rebalancer/
├── contracts/           # Soroban smart contracts
├── frontend/           # React TypeScript frontend
├── backend/            # Node.js Express API
└── docs/              # Documentation

### Tech Stack

**Smart Contracts**: Rust + Soroban
**Frontend**: React + TypeScript + Tailwind CSS
**Backend**: Node.js + Express + TypeScript
**Price Data**: Reflector + CoinGecko API
**Blockchain**: Stellar Testnet

## Quick Start

### Prerequisites

- Node.js 18+
- Rust + Cargo
- Soroban CLI
- Stellar wallet (Freighter/Rabet recommended)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/your-username/stellar-portfolio-rebalancer.git
cd stellar-portfolio-rebalancer

Install dependencies

bash# Frontend
cd frontend && npm install

# Backend
cd ../backend && npm install

# Smart contracts
cd ../contracts && cargo build

Environment setup

bash# Backend
cp .env.example .env
# Edit .env with your configuration

# Frontend
cp .env.local.example .env.local
# Edit with contract addresses

Start development servers

bash# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend
cd frontend && npm run dev

Access the application


Frontend: http://localhost:3000
Backend API: http://localhost:3001

Smart Contract Deployment
The portfolio rebalancer smart contract is deployed on Stellar testnet:
Contract Address: CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I
To deploy your own instance:
bashcd contracts

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
Usage
Creating a Portfolio

Connect your Stellar wallet
Navigate to "Create Portfolio"
Set target asset allocations (must sum to 100%)
Configure rebalance threshold (1-50%)
Enable/disable automatic rebalancing
Submit transaction

Managing Portfolios

Dashboard: View current allocations and portfolio performance
Rebalancing: Manual trigger or automatic execution when thresholds are exceeded
History: Track rebalancing events and portfolio changes

Safety Features

Cooldown Periods: Minimum 1 hour between rebalances
Volatility Detection: Pauses rebalancing during extreme market conditions
Concentration Limits: Prevents over-allocation to single assets
Circuit Breakers: Multiple safety checks before trade execution

API Reference
Portfolio Management
bash# Create portfolio
POST /api/portfolio
{
  "userAddress": "STELLAR_ADDRESS",
  "allocations": {"XLM": 40, "USDC": 35, "BTC": 25},
  "threshold": 5
}

# Get portfolio
GET /api/portfolio/:id

# Execute rebalance
POST /api/portfolio/:id/rebalance

# Get rebalance status
GET /api/portfolio/:id/rebalance-status
Price Data
bash# Current prices
GET /api/prices

# Portfolio analysis
GET /api/portfolio/:id/rebalance-plan
Configuration
Environment Variables
Backend (.env):
envCONTRACT_ADDRESS=CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I
STELLAR_NETWORK=testnet
PORT=3001
Frontend (.env.local):
envVITE_CONTRACT_ADDRESS=CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I
VITE_STELLAR_NETWORK=testnet
Development
Project Structure
frontend/src/
├── components/         # React components
├── utils/             # Utility functions
├── services/          # API and blockchain services
└── types/             # TypeScript definitions

backend/src/
├── api/               # Express routes
├── services/          # Business logic
├── monitoring/        # Portfolio monitoring
└── middleware/        # Express middleware

contracts/src/
├── lib.rs            # Main contract logic
├── types.rs          # Contract data types
└── reflector.rs      # Oracle integration
Testing
bash# Frontend tests
cd frontend && npm test

# Backend tests
cd backend && npm test

# Smart contract tests
cd contracts && cargo test
Hackathon Submission
This project was built for [Hackathon Name] and demonstrates:

Stellar Integration: Native blockchain functionality with testnet deployment
Reflector Usage: Real oracle integration for price feeds
DeFi Innovation: Automated portfolio management with risk controls
Production Quality: Professional UI/UX and robust error handling

Demo Features

Multi-wallet connection support
Real-time price visualization
Interactive portfolio creation
Simulated rebalancing with realistic delays
Comprehensive monitoring and alerting

Roadmap
Phase 1 (Current)

✅ Smart contract deployment
✅ Basic portfolio management
✅ Demo mode functionality
✅ Multi-wallet support

Phase 2 (Next)

🔄 Real DEX integration
🔄 Advanced rebalancing strategies
🔄 Portfolio analytics and backtesting
🔄 Mobile application

Phase 3 (Future)

⏳ Institutional features
⏳ Cross-chain portfolio support
⏳ Yield farming integration
⏳ Advanced risk modeling

Contributing

Fork the repository
Create a feature branch (git checkout -b feature/amazing-feature)
Commit changes (git commit -m 'Add amazing feature')
Push to branch (git push origin feature/amazing-feature)
Open a Pull Request

License
This project is licensed under the MIT License - see the LICENSE file for details.
Acknowledgments

Stellar Development Foundation for the robust blockchain infrastructure
Reflector Protocol for reliable price oracle services
Soroban for smart contract capabilities
Community for wallet integrations and ecosystem support

Built with ❤️ for the Stellar ecosystem
