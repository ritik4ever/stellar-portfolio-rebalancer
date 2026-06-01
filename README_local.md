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
- **Windows Users:** See the [Windows/WSL Local Development Workflow](docs/windows-wsl-workflow.md) for environment setup recommendations.

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

### Docker Compose

You can also run the stack using Docker Compose:

```bash
docker compose -f deployment/docker-compose.yml up --build
docker compose -f deployment/docker-compose.yml --profile full-stack up --build
docker compose -f deployment/docker-compose.yml --profile observability up --build
```

The default invocation starts the minimal app stack. Add `--profile full-stack` when you want Redis and PostgreSQL, and add `--profile observability` when you want Prometheus, Grafana, Loki, Alertmanager, Promtail, and Blackbox Exporter.

If you want the backend to talk to the PostgreSQL and Redis services in `full-stack`, set the matching `DATABASE_URL` or `PG*` env vars before you launch the stack.

> **Note:** The `docker-compose.yml` includes sensible resource limits for each service to ensure reproducibility and prevent runaway resource consumption. If you need more resources, you can override them in a `docker-compose.override.yml` file.

## Usage

- **Connect Wallet**: Connect your Stellar wallet
- **Create Portfolio**: Set target allocations and rebalance threshold
- **Monitor**: View real-time portfolio status and drift
- **Rebalance**: Manual or automatic rebalancing based on your settings

## Architecture

- **Smart Contracts**: Soroban contracts for portfolio management
- **Backend**: Node.js API with real-time monitoring
- **Frontend**: React with TypeScript and Tailwind CSS
- **Oracle**: Reflector price feeds for accurate pricing
