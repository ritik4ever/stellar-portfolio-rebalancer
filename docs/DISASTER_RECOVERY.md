# Disaster Recovery Runbook

This runbook describes the procedures for detecting, containing, rolling back, restoring, and validating outages across the smart contract, backend (database, queues, and API), and frontend components.

---

## 1. Incident Severity Levels

We classify incidents based on their impact and urgency, matching the severity definitions in [docs/TRIAGE.md](TRIAGE.md#priority-levels):

| Severity | Description | Target Response | Examples |
|---|---|---|---|
| **P0 - Critical** | Core service down, data corruption, or security/funds compromise. | **Immediate (< 4 hours)** | Backend API down, smart contract funds locked or draining, database corruption. |
| **P1 - High** | Major functionality broken for many users; no easy workaround. | **1 - 2 Days** | Wallet connection completely failing, automatic rebalancing failing for all users. |
| **P2 - Medium** | Minor features broken with available workarounds. | **1 Week** | UI visual glitches, delay in analytics updates, minor API errors. |
| **P3 - Low** | Cosmetic issues, small optimizations, or documentation gaps. | **2 - 4 Weeks** | Typos, minor performance tuning, dashboard layout adjustments. |

---

## 2. Outage Detection

### 2.1 Alert Routing
Prometheus and Alertmanager route alerts based on their severity and subsystem. Key alerting thresholds defined in `deployment/observability/prometheus/alerts.yml` include:

*   **`BackendDown` (Critical)**: Triggers when the metrics endpoint of `portfolio-backend` is unreachable for `2m`.
*   **`BackendReadinessFailed` (Critical)**: Triggers when `/readiness` returns non-2xx for `2m`.
*   **`FrontendUptimeProbeFailed` (Critical)**: Triggers when Nginx/Frontend is unreachable for `5m`.
*   **`PortfolioRebalanceFailed` (Critical)**: Triggers when failed rebalance jobs accumulate $\ge 5$ in the queue.
*   **`SystemReadinessDegraded` (Critical)**: Triggers when `stellar_portfolio_readiness_status == 0` for `2m`.
*   **`Elevated5xxRate` (Warning)**: Triggers when backend HTTP 5xx rate $> 5\%$ for `10m`.
*   **`ReflectorStalePricesDetected` (Warning)**: Price staleness detected by the portfolio rebalancer.

### 2.2 Health and Readiness Probes
The backend exposes specific endpoints for health monitoring (see [docs/OPERATIONS.md](OPERATIONS.md#health-vs-readiness)):

*   `/health`: Returns simple `200 ok`. Use for load balancer liveness checks.
*   `/api/health`: JSON payload with router status and timestamp.
*   `/ready` / `/readiness`: Deep dependency check (Database, Redis, BullMQ workers, Indexer, Auto-rebalancer). If any critical check fails, returns `503 Service Unavailable`.

### 2.3 Log Inspection
To analyze active issues:
*   **Docker Logs**: Run `docker compose logs -f backend` or `docker compose logs -f frontend` from the `deployment` directory.
*   **Log Files**: If mounted, view backend logs at `deployment/logs/backend.log`.
*   **Grafana Loki**: If the observability stack profile is active, query logs via Grafana at `http://localhost:3003` (port `3000` internal).

---

## 3. Containment Procedures

In the event of an active P0/P1 outage, containment must be executed immediately to limit impact.

### 3.1 Smart Contract Containment (Emergency Stop)
The smart contract contains a built-in emergency stop check that prevents further deposits and rebalances. If a contract bug or oracle issue is detected, trigger the emergency stop.

> [!IMPORTANT]
> Activating the emergency stop requires the administrator's key (`STELLAR_SECRET_KEY`) used during deployment.

Invoke the emergency stop using the Soroban CLI:
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <STELLAR_SECRET_KEY> \
  --network <STELLAR_NETWORK> \
  -- set_emergency_stop \
  --stop true
```
*Note: Replace `<STELLAR_NETWORK>` with `testnet` or `mainnet`, and `<CONTRACT_ID>` with the deployed contract ID.*

To resume normal operations after resolving the issue:
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <STELLAR_SECRET_KEY> \
  --network <STELLAR_NETWORK> \
  -- set_emergency_stop \
  --stop false
```

### 3.2 Backend / Queue Containment
If queue jobs are failing repeatedly or overloading downstream services:
1.  **Stop Auto-Rebalancer**: Set `ENABLE_AUTO_REBALANCER=false` in the backend environment variables and restart.
2.  **Halt Queue Processing**: Shut down the backend service or containers entirely to pause all BullMQ worker processing:
    ```bash
    docker compose -f deployment/docker-compose.yml stop backend
    ```

### 3.3 Frontend Containment (Maintenance Page)
To prevent users from interacting with a degraded platform, serve a maintenance page via Nginx:

1.  Create a `maintenance.html` file in the frontend static folder (or `/usr/share/nginx/html` in the container).
2.  Add a redirect block in your active Nginx server configuration:
    ```nginx
    # Serve maintenance page for all traffic
    error_page 503 /maintenance.html;
    location / {
        return 503;
    }
    location = /maintenance.html {
        root /usr/share/nginx/html;
    }
    ```
3.  Reload Nginx:
    ```bash
    docker compose -f deployment/docker-compose.yml exec frontend nginx -s reload
    ```

---

## 4. Rollback Procedures

### 4.1 Smart Contract Rollback
Soroban smart contracts are immutable. There is no built-in on-chain upgrade method. 
If a critical contract bug requires a rollback:
1.  **Deploy Corrected Contract**: Build and deploy a corrected version of the contract to obtain a new Contract ID:
    ```bash
    cd contracts
    make build-optimized
    soroban contract deploy \
      --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
      --source <STELLAR_SECRET_KEY> \
      --network <STELLAR_NETWORK>
    ```
2.  **Update Environment Configurations**: Update the new contract ID in the backend and frontend `.env` configurations:
    *   Backend env: `STELLAR_CONTRACT_ADDRESS` (or alias `CONTRACT_ADDRESS`)
    *   Frontend env: `VITE_CONTRACT_ADDRESS`
3.  **Redeploy Services**: Redeploy backend and frontend services using the updated configurations.

### 4.2 Backend Rollback
If a buggy backend release was deployed:
1.  **Revert Image/Commit**: Revert to the last stable git tag or Docker image tag:
    ```bash
    git checkout <last-stable-tag>
    # Rebuild and restart the container
    docker compose -f deployment/docker-compose.yml up -d --build backend
    ```
2.  **Database Migration Rollback**: If a database schema update introduced breaking changes, roll back the schema migrations (supported when running with a PostgreSQL target database configuration):
    ```bash
    docker compose -f deployment/docker-compose.yml exec backend npm run db:migrate:rollback
    ```
    *Note: By default, this rolls back the single most recent migration. To roll back multiple migrations, append the count, e.g., `npm run db:migrate:rollback -- 3`.*

### 4.3 Frontend Rollback
If the frontend UI breaks:
1.  Revert the repository to the last stable frontend build commit.
2.  Build and deploy the frontend bundle:
    ```bash
    cd frontend
    npm install
    npm run build
    ```
3.  Restart Nginx or redeploy the frontend container:
    ```bash
    docker compose -f deployment/docker-compose.yml restart frontend
    ```

---

## 5. Restore Procedures

### 5.1 Database Restoration
Depending on whether SQLite or PostgreSQL is configured as the active backend database:

#### Option A: SQLite Database Recovery
SQLite database files are stored inside the persistent volume (mapped to `/app/data/` in Docker, defaults locally to `backend/data/portfolio.db`).

*   **Backup**: Operators should regularly copy the `portfolio.db` file to a secure backup storage directory:
    ```bash
    cp backend/data/portfolio.db /backup/path/portfolio_backup_$(date +%Y%m%d_%H%M%S).db
    ```
*   **Restore**:
    1.  Stop the backend service:
        ```bash
        docker compose -f deployment/docker-compose.yml stop backend
        ```
    2.  Overwrite the database file with the backup copy:
        ```bash
        cp /backup/path/portfolio_backup_target.db backend/data/portfolio.db
        ```
    3.  Restart the backend:
        ```bash
        docker compose -f deployment/docker-compose.yml start backend
        ```

#### Option B: PostgreSQL Database Recovery
When PostgreSQL is configured (via `DATABASE_URL` or explicit `PG*` env variables):

*   **Backup**: Run `pg_dump` on the postgres container:
    ```bash
    docker exec -t portfolio-postgres pg_dump -U portfolio -d portfolio > /backup/path/postgres_backup_$(date +%Y%m%d_%H%M%S).sql
    ```
*   **Restore**:
    1.  Ensure backend traffic is stopped or backend is halted.
    2.  Drop and recreate the database or restore directly using `psql`:
        ```bash
        docker exec -i portfolio-postgres psql -U portfolio -d portfolio < /backup/path/postgres_backup_target.sql
        ```

### 5.2 Event Indexer Position Reset
If the contract event indexer is stuck, out of sync, or missed historical events:
1.  **Stop Backend**: To prevent database lock contention.
2.  **Reset Cursor / Force Sync**: Use the administrative reindex CLI script from the backend directory.
    *   **Dry Run**: Verify what ledgers will be reindexed:
        ```bash
        export ADMIN_REINDEX_KEY=your_admin_reindex_key
        npx tsx scripts/reindex-events.ts --full --dry-run
        ```
    *   **Full Reindex**: Clear the stored cursor and replay history from the bootstrap window:
        ```bash
        npx tsx scripts/reindex-events.ts --full
        ```
    *   **Backfill From Ledger**: Specify a starting ledger sequence:
        ```bash
        npx tsx scripts/reindex-events.ts --from-ledger <ledger_sequence_number>
        ```
3.  **Start Backend**: Resume backend API and worker processing.

---

## 6. Validation Checklist

Once restore or rollback steps are completed, verify system health using the following validation steps:

- [ ] **Liveness Verification**: Call the liveness endpoint to ensure the process is running:
  ```bash
  curl -I http://localhost:3001/health
  ```
  *Expected Response: `HTTP/1.1 200 OK` (body: `ok`)*

- [ ] **Deep Dependency Readiness**: Call the readiness endpoint to probe DB, Redis, workers, and indexer connection:
  ```bash
  curl -i http://localhost:3001/ready
  ```
  *Expected Response: `HTTP/1.1 200 OK` (confirming all checks show status `ready`)*

- [ ] **Run Smoke Tests**: Execute the automated health smoke test script to validate API, readiness, metrics, and health endpoints:
  ```bash
  npm run smoke
  # Or run directly against local/staging/prod URLs:
  bash scripts/health-smoke.sh local
  ```

- [ ] **Verify Frontend Loading**: Access the frontend URL (default `http://localhost:3000`) and verify assets load, wallet connects, and contract address is correctly configured.

---

## 7. Escalation Path

If an incident cannot be resolved using this runbook:

1.  **Notify Core Maintainers**: Reference contacts in [docs/TRIAGE.md](TRIAGE.md#escalation-process).
2.  **Security Incidents**: For vulnerabilities or funds compromise, follow the private escalation channel details in [docs/TRIAGE.md](TRIAGE.md#security-triage) instead of public issue trackers.
3.  **Stellar Network Inquiries**: If issues stem from upstream Stellar network failures, consult the official [Stellar Status Dashboard](https://status.stellar.org/).
