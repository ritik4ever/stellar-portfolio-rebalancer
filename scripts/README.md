# Scripts

Utility and automation scripts for the Stellar Portfolio Rebalancer monorepo.

## python_api_client.py

A Python CLI client for the Stellar Portfolio Rebalancer REST API. Requires Python 3.8+ and the `requests` library.

### Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install requests
```

### Environment

| Variable  | Default                            | Description           |
|-----------|------------------------------------|-----------------------|
| `API_URL` | `http://localhost:3001/api/v1`     | Base URL of the API   |
| `API_KEY` | _(none)_                           | Optional Bearer token |

### Usage

All commands accept `--api-url` and `--api-key` flags (which override environment variables).

```bash
# Check API health
python python_api_client.py health

# Fetch current asset prices
python python_api_client.py prices

# Create a new portfolio
python python_api_client.py create-portfolio \
  --address GABCDEF1234567890... \
  --assets "XLM:40,USDC:60" \
  --name "My Portfolio"

# Get a portfolio by ID
python python_api_client.py portfolio --portfolio-id abc-123

# View rebalance plan (drift analysis + planned trades)
python python_api_client.py plan --portfolio-id abc-123

# Execute a manual rebalance
python python_api_client.py rebalance --portfolio-id abc-123

# Fetch rebalance history (optionally filter by portfolio)
python python_api_client.py history
python python_api_client.py history --portfolio-id abc-123 --limit 10
```

### Programmatic Use

```python
from python_api_client import RebalancerClient

client = RebalancerClient("http://localhost:3001/api/v1")

prices = client.get_prices()
print(prices)

result = client.create_portfolio(
    address="GABC...",
    allocations=[{"asset": "XLM", "percentage": 40}, {"asset": "USDC", "percentage": 60}],
)
print(result)
```

### API Coverage

The `RebalancerClient` class supports these endpoints:

| Method                        | Endpoint                                |
|-------------------------------|-----------------------------------------|
| `health()`                    | `GET /health`                           |
| `system_status()`             | `GET /system/status`                    |
| `readiness()`                 | `GET /system/readiness`                 |
| `get_prices()`                | `GET /prices`                           |
| `get_enhanced_prices()`       | `GET /prices/enhanced`                  |
| `get_market_details(asset)`   | `GET /market/:asset/details`            |
| `get_price_chart(asset)`      | `GET /market/:asset/chart`              |
| `create_portfolio(...)`       | `POST /portfolio`                       |
| `get_portfolio(id)`           | `GET /portfolio/:id`                    |
| `update_portfolio(...)`       | `PUT /portfolio/:id`                    |
| `list_user_portfolios(addr)`  | `GET /user/:address/portfolios`         |
| `search_portfolios(...)`      | `GET /portfolios`                       |
| `get_rebalance_plan(id)`      | `GET /portfolio/:id/rebalance-plan`     |
| `get_rebalance_estimate(id)`  | `GET /portfolio/:id/rebalance-estimate` |
| `execute_rebalance(id)`       | `POST /portfolio/:id/rebalance`         |
| `get_rebalance_summary(id)`   | `GET /rebalance/summary/:portfolioId`   |
| `get_rebalance_history(...)`  | `GET /rebalance/history`                |
| `auto_rebalancer_status()`    | `GET /auto-rebalancer/status`           |
| `get_assets()`                | `GET /assets`                           |
| `get_strategies()`            | `GET /strategies`                       |
| `get_risk_metrics(id)`        | `GET /risk/metrics/:portfolioId`        |
| `check_risk(id)`              | `GET /risk/check/:portfolioId`          |
| `subscribe_notifications(...)`| `POST /notifications/subscribe`         |
| `get_notification_preferences`| `GET /notifications/preferences`        |

## Other Scripts

| Script                          | Purpose                                      |
|---------------------------------|----------------------------------------------|
| `run-test-suite.mjs`            | Run the full monorepo test suite             |
| `run-local-checks.mjs`          | Pre-commit / pre-push local checks           |
| `validate-env-examples.mjs`     | Validate `.env.example` files                |
| `install-git-hooks.mjs`         | Install git hooks from `scripts/hooks/`      |
| `check-commit-messages.sh`      | Validate commit message format               |
| `check-generated-artifacts.sh`  | Verify generated files are up-to-date        |
| `check-npm-audit-baseline.mjs`  | Enforce npm audit policy                     |
| `sentry-metadata.mjs`           | Generate Sentry instrumentation metadata     |
| `health-smoke.sh`               | Smoke test for API health endpoints          |
| `queue-health-check.mjs`        | BullMQ queue health check                    |
| `snapshot-diff.mjs`             | Compare Soroban contract test snapshots      |
| `manage-flaky-tests.sh`         | Manage flaky test detection                  |
| `loki-retention-check.sh`       | Loki log retention check                     |
| `bootstrap-observability.sh`    | Bootstrap observability stack                |
