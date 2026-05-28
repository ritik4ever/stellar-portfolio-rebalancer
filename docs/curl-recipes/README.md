# cURL Recipe Examples

This folder contains ready-to-run `curl` commands for every API route in the Stellar Portfolio Rebalancer.

Use these recipes to:

- Quickly test the API during development
- Debug authentication and token flows
- Automate health checks or monitoring
- Understand request/response shapes without reading the full spec

> **Prerequisites:** `curl` 7.68+ with `-w` / `--write-out` support (default on Ubuntu 20.04+, macOS).

---

## Setup

```bash
# Replace with your backend URL
export BASE_URL=http://localhost:3001

# Login to obtain a JWT (see recipes/auth/)
```

---

## Recipe index

| Category            | Folder / file                    | Description                             |
| ------------------- | -------------------------------- | --------------------------------------- |
| **Auth**            | `recipes/auth/`                  | Login, refresh, logout                  |
| **Portfolios**      | `recipes/portfolios/`            | CRUD + rebalance triggers               |
| **Markets**         | `recipes/markets/`               | Current market data and price feeds     |
| **Analytics**       | `recipes/analytics/`             | Performance and risk metrics            |
| **Strategies**      | `recipes/strategies/`            | Rebalancing strategy management         |
| **Health**          | `recipes/health/`                | Server health and readiness probes      |
| **Events**          | `recipes/events/`                | Contract event querying                 |
| **Notifications**   | `recipes/notifications/`         | Notification channel management         |

---

## Usage

```bash
# Run any recipe directly
cd docs/curl-recipes
chmod +x recipes/**/*.sh
bash recipes/auth/login.sh

# Pass custom BASE_URL
BASE_URL=https://api.example.com bash recipes/auth/login.sh
```

---

## Adding new recipes

1. Add a `.sh` file in the appropriate `recipes/<category>/` folder.
2. Start with `#!/usr/bin/env bash` and `set -euo pipefail`.
3. Use `$BASE_URL` (fall back to `http://localhost:3001`).
4. Print the request URL and method, then the response with `curl -sS`.
5. Make the script executable (`chmod +x`).
6. Add the file to the index above.

See [recipes/template.sh](recipes/template.sh) for a reusable template.
