# Stellar Portfolio Rebalancer

An intelligent portfolio rebalancing service built for the Stellar ecosystem, leveraging Reflector's price oracles for accurate, manipulation-resistant pricing data.

## Features

- **Smart Rebalancing**: Automatically maintains target allocations with customizable drift thresholds
- **Real-time Monitoring**: Continuous portfolio monitoring with WebSocket updates
- **Risk Management**: Built-in safeguards and circuit breakers
- **Modern UI**: Clean, intuitive interface inspired by modern fintech applications
- **Oracle Integration**: Powered by Reflector's decentralized price feeds

## Quick Start

### Prerequisites

- Node.js 18+
- Rust (for smart contracts)
- Stellar account with testnet lumens

### Installation

1. Clone the repository
```bash
git clone https://github.com/your-username/stellar-portfolio-rebalancer
cd stellar-portfolio-rebalancer
```

2. Install dependencies
```bash
# Install contract dependencies
cd contracts && cargo build

# Install frontend dependencies
cd ../frontend && npm install

# Install backend dependencies
cd ../backend && npm install
```

3. Configure environment
```bash
# Create .env files with your configuration
cp .env.example .env
```

4. Deploy smart contract
```bash
cd contracts
make deploy-testnet
```

5. Start development servers
```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend
cd frontend && npm run dev
```

## Usage

- **Connect Wallet**: Connect your Stellar wallet
- **Create Portfolio**: Set target allocations and rebalance threshold
- **Monitor**: View real-time portfolio status and drift
- **Rebalance**: Manual or automatic rebalancing based on your settings

## Local Reflector Oracle Mock (Offline Dev)

When developing locally or offline without access to live market feeds, `docker-compose up` runs a lightweight local **Reflector Oracle Mock** container alongside backend services.

### Running with Docker Compose
```bash
docker compose -f deployment/docker-compose.yml up -d
```

### Overriding Mock Prices for Testing Scenarios
You can configure or dynamically push custom asset prices to simulate market conditions like volatility spikes:

#### Initial Configuration via Env
Set initial prices in environment variables before launching:
```bash
MOCK_PRICE_XLM=0.50 MOCK_PRICE_BTC=150000 ENABLE_RANDOMIZATION=true docker compose -f deployment/docker-compose.yml up -d
```

#### Dynamic Price Override (HTTP POST)
To simulate a volatility spike or test specific rebalance drift thresholds while services are running:
```bash
# Override specific asset prices
curl -X POST http://localhost:8080/prices \
  -H "Content-Type: application/json" \
  -d '{"prices": {"XLM": 0.85, "BTC": 150000, "ETH": 2500}}'

# Toggle price randomization
curl -X POST http://localhost:8080/config \
  -H "Content-Type: application/json" \
  -d '{"enableRandomization": true}'
```

## Architecture

- **Smart Contracts**: Soroban contracts for portfolio management
- **Backend**: Node.js API with real-time monitoring
- **Frontend**: React with TypeScript and Tailwind CSS
- **Oracle**: Reflector price feeds with local mock service for offline dev
 