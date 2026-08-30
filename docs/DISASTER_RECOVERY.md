# Disaster Recovery Runbook

This runbook describes the procedures for detecting, containing, rolling back, restoring, and validating outages across the smart contract, backend (database, queues, and API), and frontend components. It includes multi-region failover procedures aligned to the DR terraform module.

---

## Table of Contents

1. [Incident Severity Levels](#1-incident-severity-levels)
2. [RTO/RPO Targets](#2-rtorpo-targets)
3. [Infrastructure Overview](#3-infrastructure-overview)
4. [Outage Detection](#4-outage-detection)
5. [Containment Procedures](#5-containment-procedures)
6. [Rollback Procedures](#6-rollback-procedures)
7. [Restore Procedures](#7-restore-procedures)
8. [Multi-Region Failover Procedures](#8-multi-region-failover-procedures)
9. [Failback Procedures](#9-failback-procedures)
10. [Failover Test Procedure](#10-failover-test-procedure)
11. [Validation Checklist](#11-validation-checklist)
12. [Escalation Path](#12-escalation-path)

---

## 1. Incident Severity Levels

We classify incidents based on their impact and urgency, matching the severity definitions in [docs/TRIAGE.md](TRIAGE.md#priority-levels):

| Severity | Description | Target Response | Examples |
|---|---|---|---|
| **P0 - Critical** | Core service down, data corruption, or security/funds compromise. | **Immediate (< 4 hours)** | Backend API down, smart contract funds locked or draining, database corruption, regional outage. |
| **P1 - High** | Major functionality broken for many users; no easy workaround. | **1 - 2 Days** | Wallet connection completely failing, automatic rebalancing failing for all users. |
| **P2 - Medium** | Minor features broken with available workarounds. | **1 Week** | UI visual glitches, delay in analytics updates, minor API errors. |
| **P3 - Low** | Cosmetic issues, small optimizations, or documentation gaps. | **2 - 4 Weeks** | Typos, minor performance tuning, dashboard layout adjustments. |

---

## 2. RTO/RPO Targets

### 2.1 Recovery Objectives

| Component | RTO (Recovery Time Objective) | RPO (Recovery Point Objective) | Current Capability | Gap Analysis |
|---|---|---|---|---|
| **Database (PostgreSQL)** | 30 minutes | 5 minutes | Single-region, no cross-region replication | **GAP**: No automated failover; manual restore from backups required |
| **Backend API** | 15 minutes | N/A (stateless) | ECS Fargate multi-AZ in primary region | **GAP**: No cross-region ECS deployment |
| **Redis Cache** | 5 minutes | 0 (ephemeral) | Single-node ElastiCache | **GAP**: No Redis replication; cache loss on failover |
| **Frontend (S3/CloudFront)** | 5 minutes | N/A (static assets) | CloudFront global CDN | **MEETS**: CloudFront serves from nearest edge |
| **Smart Contract** | N/A | N/A | On-chain (Stellar network) | **MEETS**: No failover needed |

### 2.2 Current Infrastructure Capabilities

The current Terraform modules deploy a single-region architecture:

- **Primary Region**: `us-east-1` (configurable via `aws_region` variable)
- **VPC**: Multi-AZ deployment with public and private subnets
- **RDS**: Single instance, no Multi-AZ standby, no cross-region read replicas
- **ElastiCache**: Single Redis node, no replication
- **ECS**: Fargate tasks in private subnets behind ALB
- **Frontend**: S3 bucket with CloudFront distribution (global)

### 2.3 Target State (Multi-Region DR)

To meet the stated RTO/RPO targets, the following enhancements are required:

1. **RDS**: Enable Multi-AZ deployment and create cross-region read replica in DR region
2. **ElastiCache**: Enable Redis replication group with cross-region replica
3. **ECS**: Deploy standby ECS cluster in DR region
4. **Route53**: Add health checks and failover routing
5. **Secrets Manager**: Enable cross-region secret replication

---

## 3. Infrastructure Overview

### 3.1 Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PRIMARY REGION (us-east-1)                │
├─────────────────────────────────────────────────────────────┤
│  CloudFront (Global)                                        │
│    └── S3 Bucket (Frontend Assets)                          │
│                                                              │
│  ALB                                                        │
│    └── ECS Fargate (Backend API)                            │
│         ├── RDS PostgreSQL (Primary)                         │
│         └── ElastiCache Redis (Primary)                     │
└─────────────────────────────────────────────────────────────┘
                           │
                    [Failover Trigger]
                           │
┌─────────────────────────────────────────────────────────────┐
│                    DR REGION (us-west-2)                     │
├─────────────────────────────────────────────────────────────┤
│  ALB                                                        │
│    └── ECS Fargate (Backend API - Standby)                  │
│         ├── RDS PostgreSQL (Read Replica)                    │
│         └── ElastiCache Redis (Replica)                     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Key Terraform Modules

| Module | Purpose | DR Relevance |
|---|---|---|
| `modules/vpc` | VPC with multi-AZ subnets | Must be deployed in both regions |
| `modules/rds` | PostgreSQL database | Requires Multi-AZ + cross-region replica |
| `modules/elasticache` | Redis cache | Requires replication group |
| `modules/ecs` | ECS Fargate backend | Must be deployed in both regions |
| `modules/s3_cloudfront` | Frontend hosting | CloudFront handles global distribution |

---

## 4. Outage Detection

### 4.1 Alert Routing
Prometheus and Alertmanager route alerts based on their severity and subsystem. Key alerting thresholds defined in `deployment/observability/prometheus/alerts.yml` include:

*   **`BackendDown` (Critical)**: Triggers when the metrics endpoint of `portfolio-backend` is unreachable for `2m`.
*   **`BackendReadinessFailed` (Critical)**: Triggers when `/readiness` returns non-2xx for `2m`.
*   **`FrontendUptimeProbeFailed` (Critical)**: Triggers when Nginx/Frontend is unreachable for `5m`.
*   **`PortfolioRebalanceFailed` (Critical)**: Triggers when failed rebalance jobs accumulate $\ge 5$ in the queue.
*   **`SystemReadinessDegraded` (Critical)**: Triggers when `stellar_portfolio_readiness_status == 0` for `2m`.
*   **`Elevated5xxRate` (Warning)**: Triggers when backend HTTP 5xx rate $> 5\%$ for `10m`.
*   **`ReflectorStalePricesDetected` (Warning)**: Price staleness detected by the portfolio rebalancer.
*   **`RegionalFailoverRequired` (Critical)**: Triggers when primary region health checks fail for `5m`.

### 4.2 Health and Readiness Probes
The backend exposes specific endpoints for health monitoring (see [docs/OPERATIONS.md](OPERATIONS.md#health-vs-readiness)):

*   `/health`: Returns simple `200 ok`. Use for load balancer liveness checks.
*   `/api/health`: JSON payload with router status and timestamp.
*   `/ready` / `/readiness`: Deep dependency check (Database, Redis, BullMQ workers, Indexer, Auto-rebalancer). If any critical check fails, returns `503 Service Unavailable`.

### 4.3 Log Inspection
To analyze active issues:
*   **Docker Logs**: Run `docker compose logs -f backend` or `docker compose logs -f frontend` from the `deployment` directory.
*   **Log Files**: If mounted, view backend logs at `deployment/logs/backend.log`.
*   **Grafana Loki**: If the observability stack profile is active, query logs via Grafana at `http://localhost:3003` (port `3000` internal).

### 4.4 Regional Health Monitoring

For multi-region deployments, monitor health of both primary and DR regions:

```bash
# Check primary region health
curl -s https://primary.stellar-portfolio.example.com/health

# Check DR region health
curl -s https://dr.stellar-portfolio.example.com/health

# Check Route53 health check status
aws route53 get-health-check-status --health-check-id <health-check-id>
```

---

## 5. Containment Procedures

In the event of an active P0/P1 outage, containment must be executed immediately to limit impact.

### 5.1 Smart Contract Containment (Emergency Stop)
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

### 5.2 Backend / Queue Containment
If queue jobs are failing repeatedly or overloading downstream services:
1.  **Stop Auto-Rebalancer**: Set `ENABLE_AUTO_REBALANCER=false` in the backend environment variables and restart.
2.  **Halt Queue Processing**: Shut down the backend service or containers entirely to pause all BullMQ worker processing:
    ```bash
    docker compose -f deployment/docker-compose.yml stop backend
    ```

### 5.3 Frontend Containment (Maintenance Page)
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

### 5.4 Regional Containment

If a regional outage is detected:

1.  **Verify Primary Region Status**: Confirm the outage is region-wide, not just a single component.
2.  **Initiate DNS Failover**: If using Route53 failover routing, the health check will automatically redirect traffic. If manual intervention is needed, update DNS records.
3.  **Scale Down Primary Region** (optional): If the primary region is experiencing partial failure (e.g., database issues but compute is healthy), scale down ECS tasks to prevent resource contention:
    ```bash
    aws ecs update-service \
      --cluster <primary-cluster-name> \
      --service <primary-service-name> \
      --desired-count 0 \
      --region us-east-1
    ```

---

## 6. Rollback Procedures

### 4.1 Smart Contract Rollback
The contract exposes an `upgrade()` entrypoint that calls
`update_current_contract_wasm` to swap the on-chain WASM blob. This allows
reverting to a previous code version without deploying a new contract ID.

**When rollback is safe:** if the upgrade was a plain WASM swap and no
storage-migration hook mutated persistent entries, you can point the contract
back to the previous WASM hash:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source <STELLAR_SECRET_KEY> \
  --network <STELLAR_NETWORK> \
  -- upgrade \
  --new_wasm_hash $PREVIOUS_WASM_HASH
```

**When rollback requires a new contract:** if `migrate_storage` transformed
storage entries during the upgrade, the old WASM cannot deserialize the
migrated data. In that case:

1.  **Deploy Corrected Contract**: Build and deploy a corrected version of the contract to obtain a new Contract ID:
    ```bash
    cd contracts
    make build-optimized
    soroban contract deploy \
      --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
      --source <STELLAR_SECRET_KEY> \
      --network <STELLAR_NETWORK>
    ```
2.  **Assess state loss**: Deploying a fresh contract starts with empty
    persistent storage. All on-chain state — portfolio records, balances,
    fee configuration, DCA configurations, and NAV history — is **not**
    transferred. Before proceeding:
    - Export portfolio records and target allocations from the old contract
      via event replay or indexer data so users can re-create them.
    - Inform users they must re-deposit funds into the new contract, since
      asset balances held by the old contract are not migrated.
    - Activate the emergency stop on the old contract to prevent further
      deposits into the abandoned instance.
3.  **Update Environment Configurations**: Update the new contract ID in the backend and frontend `.env` configurations:
    *   Backend env: `STELLAR_CONTRACT_ADDRESS` (or alias `CONTRACT_ADDRESS`)
    *   Frontend env: `VITE_CONTRACT_ADDRESS`
4.  **Redeploy Services**: Redeploy backend and frontend services using the updated configurations.
5.  **Validate**: Create a test portfolio, execute a full deposit/withdraw/rebalance cycle, and confirm the indexer is syncing events from the new contract.

### 6.2 Backend Rollback
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

### 6.3 Frontend Rollback
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

## 7. Restore Procedures

### 7.1 Database Restoration
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

### 7.2 Cross-Region Database Restore

For multi-region DR, restore from cross-region read replica or S3 backup:

#### Option A: Promote Cross-Region Read Replica

If a cross-region read replica has been set up:

```bash
# Promote read replica to standalone instance in DR region
aws rds promote-read-replica \
  --db-instance-identifier stellar-portfolio-dr-db \
  --region us-west-2
```

*Note: Promotion is irreversible. The replica becomes a standalone instance and can no longer receive replication updates.*

#### Option B: Restore from S3 Backup

If using automated backups to S3:

```bash
# List available backups
aws rds describe-db-snapshots \
  --db-instance-identifier stellar-portfolio-primary-db \
  --region us-east-1 \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table

# Restore from most recent snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier stellar-portfolio-dr-db \
  --db-snapshot-identifier <snapshot-id> \
  --db-instance-class db.t4g.small \
  --region us-west-2
```

### 7.3 Event Indexer Position Reset
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

## 8. Multi-Region Failover Procedures

### 8.1 Failover Decision Criteria

Initiate failover when ANY of the following conditions are met:

1. **Primary region health checks failing for > 5 minutes**
2. **Database unresponsive in primary region**
3. **Regional AWS service degradation affecting multiple components**
4. **RTO approaching threshold** (30 minutes for database, 15 minutes for API)

### 8.2 Pre-Failover Checklist

Before initiating failover, verify:

- [ ] DR region infrastructure is deployed and healthy
- [ ] Cross-region database replica is in sync (check replication lag < 5 minutes)
- [ ] DNS failover routing is configured (Route53 health checks active)
- [ ] All required secrets are replicated to DR region
- [ ] DR region ECS tasks are running and passing health checks

### 8.3 Failover Execution Steps

#### Step 1: Confirm Primary Region Failure

```bash
# Check primary region health
curl -sf https://primary.stellar-portfolio.example.com/health || echo "PRIMARY UNREACHABLE"

# Check AWS service health
aws health describe-events --region us-east-1

# Verify RDS primary status
aws rds describe-db-instances \
  --db-instance-identifier stellar-portfolio-primary-db \
  --region us-east-1 \
  --query 'DBInstances[0].DBInstanceStatus'
```

#### Step 2: Promote DR Database (if using read replica)

```bash
# Check replication lag before promotion
aws rds describe-db-instances \
  --db-instance-identifier stellar-portfolio-dr-db \
  --region us-west-2 \
  --query 'DBInstances[0].StatusInfos'

# Promote replica to primary
aws rds promote-read-replica \
  --db-instance-identifier stellar-portfolio-dr-db \
  --region us-west-2

# Wait for promotion to complete (typically 5-10 minutes)
aws rds wait db-instance-available \
  --db-instance-identifier stellar-portfolio-dr-db \
  --region us-west-2
```

#### Step 3: Scale Up DR ECS Services

```bash
# Scale backend to production capacity
aws ecs update-service \
  --cluster stellar-portfolio-dr-ecs-cluster \
  --service stellar-portfolio-dr-service \
  --desired-count 2 \
  --region us-west-2

# Wait for tasks to become healthy
aws ecs wait services-stable \
  --cluster stellar-portfolio-dr-ecs-cluster \
  --services stellar-portfolio-dr-service \
  --region us-west-2
```

#### Step 4: Update DNS Failover (if not automated)

```bash
# Update Route53 to failover to DR region
aws route53 change-resource-record-sets \
  --hosted-zone-id <hosted-zone-id> \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.stellar-portfolio.example.com",
        "Type": "A",
        "SetIdentifier": "failover-dr",
        "Failover": "PRIMARY",
        "AliasTarget": {
          "HostedZoneId": "<dr-alb-hosted-zone-id>",
          "DNSName": "<dr-alb-dns-name>",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

#### Step 5: Verify DR Region Health

```bash
# Check DR region health
curl -sf https://dr.stellar-portfolio.example.com/health

# Verify database connectivity
curl -sf https://dr.stellar-portfolio.example.com/ready

# Run smoke tests against DR endpoint
bash scripts/health-smoke.sh dr
```

#### Step 6: Notify Stakeholders

Send notification to the team:

```
[DR FAILOVER EXECUTED]
- Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
- Primary Region: us-east-1 (UNHEALTHY)
- DR Region: us-west-2 (ACTIVE)
- RTO Achieved: [X] minutes
- Action Required: Monitor DR region, investigate primary region
```

### 8.4 Post-Failover Monitoring

After failover, monitor the following:

1. **Application Health**: Continuously check `/health` and `/ready` endpoints
2. **Database Performance**: Monitor query latency and connection counts
3. **Error Rates**: Watch for elevated 5xx rates
4. **User Impact**: Monitor for user-reported issues

---

## 9. Failback Procedures

Failback is the process of restoring operations to the primary region after it recovers.

### 9.1 Pre-Failback Checklist

Before initiating failback, verify:

- [ ] Primary region infrastructure is fully operational
- [ ] Primary database is healthy and has caught up with DR region changes
- [ ] Data sync from DR to Primary is complete
- [ ] All services are tested and healthy in primary region
- [ ] Maintenance window is communicated to stakeholders

### 9.2 Failback Execution Steps

#### Step 1: Verify Primary Region Recovery

```bash
# Check primary region health
curl -sf https://primary.stellar-portfolio.example.com/health

# Verify RDS primary is available
aws rds describe-db-instances \
  --db-instance-identifier stellar-portfolio-primary-db \
  --region us-east-1 \
  --query 'DBInstances[0].DBInstanceStatus'
```

#### Step 2: Sync Data from DR to Primary

If the primary database was restored from backup, sync any changes made during DR:

```bash
# Option A: Use pg_dump/pg_restore for data sync
pg_dump -h <dr-db-endpoint> -U portfolio -d portfolio | \
  psql -h <primary-db-endpoint> -U portfolio -d portfolio

# Option B: If using AWS DMS (Database Migration Service)
aws dms start-replication-task \
  --replication-task-arn <task-arn> \
  --start-replication-task-type load-and-cache
```

#### Step 3: Scale Down DR Region

```bash
# Scale DR backend to minimal capacity
aws ecs update-service \
  --cluster stellar-portfolio-dr-ecs-cluster \
  --service stellar-portfolio-dr-service \
  --desired-count 1 \
  --region us-west-2
```

#### Step 4: Update DNS to Primary

```bash
# Restore Route53 to primary region
aws route53 change-resource-record-sets \
  --hosted-zone-id <hosted-zone-id> \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.stellar-portfolio.example.com",
        "Type": "A",
        "SetIdentifier": "failover-primary",
        "Failover": "PRIMARY",
        "AliasTarget": {
          "HostedZoneId": "<primary-alb-hosted-zone-id>",
          "DNSName": "<primary-alb-dns-name>",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

#### Step 5: Re-establish Cross-Region Replication

```bash
# Create new read replica in DR region from primary
aws rds create-db-instance-read-replica \
  --db-instance-identifier stellar-portfolio-dr-db \
  --source-db-instance-identifier stellar-portfolio-primary-db \
  --region us-west-2

# Wait for replica to be available
aws rds wait db-instance-available \
  --db-instance-identifier stellar-portfolio-dr-db \
  --region us-west-2
```

#### Step 6: Verify Primary Region Operations

```bash
# Check primary region health
curl -sf https://primary.stellar-portfolio.example.com/health

# Run smoke tests
bash scripts/health-smoke.sh primary

# Verify replication status
aws rds describe-db-instances \
  --db-instance-identifier stellar-portfolio-dr-db \
  --region us-west-2 \
  --query 'DBInstances[0].StatusInfos'
```

#### Step 7: Notify Stakeholders

```
[DR FAILBACK COMPLETED]
- Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
- Primary Region: us-east-1 (ACTIVE)
- DR Region: us-west-2 (STANDBY)
- Total DR Duration: [X] hours
- Data Loss: [None/Minimal - specify]
```

---

## 10. Failover Test Procedure

### 10.1 Overview

Regular failover testing ensures the DR procedure works when needed. Testing should be performed quarterly or after significant infrastructure changes.

> [!CAUTION]
> Failover testing should be performed in a staging environment first. Production testing requires approval from the team lead and should be scheduled during low-traffic periods.

### 10.2 Test Environment Setup

#### Option A: Staging Environment Test (Recommended)

```bash
# Deploy staging environment with DR capabilities
cd deployment/terraform
terraform workspace new staging-dr-test
terraform apply -var-file="staging.tfvars"
```

#### Option B: Production Dry Run (No Traffic Shift)

Perform all steps up to but not including DNS failover.

### 10.3 Failover Test Checklist

#### Phase 1: Pre-Test Verification

- [ ] Confirm DR region infrastructure is healthy
- [ ] Verify cross-region replication is active
- [ ] Notify team of test window
- [ ] Set up monitoring dashboards for both regions
- [ ] Record baseline metrics (latency, error rates, throughput)

#### Phase 2: Simulate Primary Failure

**Method 1: Database Failover Test**

```bash
# Simulate database failure by stopping primary
aws rds stop-db-instance \
  --db-instance-identifier stellar-portfolio-primary-db \
  --region us-east-1

# Monitor failover (if Multi-AZ is enabled)
watch -n 5 'aws rds describe-db-instances \
  --db-instance-identifier stellar-portfolio-primary-db \
  --region us-east-1 \
  --query "DBInstances[0].StatusInfos"'
```

**Method 2: ECS Service Disruption**

```bash
# Scale primary region to zero
aws ecs update-service \
  --cluster stellar-portfolio-primary-ecs-cluster \
  --service stellar-portfolio-primary-service \
  --desired-count 0 \
  --region us-east-1
```

**Method 3: Security Group Isolation**

```bash
# Revoke all inbound access to primary region database
aws ec2 revoke-security-group-ingress \
  --group-id <primary-rds-sg-id> \
  --protocol tcp \
  --port 5432 \
  --cidr 10.0.0.0/16
```

#### Phase 3: Execute Failover

Follow the failover execution steps from [Section 8.3](#83-failover-execution-steps), but only through Step 5 (Verify DR Region Health).

#### Phase 4: Validate DR Region

- [ ] DR region health checks passing
- [ ] API responses are correct
- [ ] Database queries are functional
- [ ] Cache is warming up (expected cache misses)
- [ ] No user-facing errors

#### Phase 5: Failback

Follow the failback procedures from [Section 9.2](#92-failback-execution-steps).

#### Phase 6: Post-Test Validation

- [ ] Primary region fully operational
- [ ] Cross-region replication restored
- [ ] All metrics returned to baseline
- [ ] Test results documented

### 10.4 Test Results Documentation

Document the following metrics:

| Metric | Primary (Before) | DR Region (During) | Primary (After) | Notes |
|---|---|---|---|---|
| RTO Achieved | - | [X] minutes | - | Time from failure detection to DR active |
| RPO Achieved | - | [X] minutes | - | Data loss window |
| API Latency (p99) | [X] ms | [X] ms | [X] ms | |
| Error Rate | [X]% | [X]% | [X]% | |
| Database Connections | [X] | [X] | [X] | |

### 10.5 Common Test Failures and Remediation

| Failure | Likely Cause | Remediation |
|---|---|---|
| DR database not ready | Replication lag too high | Increase replication frequency, reduce write volume during failover |
| DR ECS tasks failing health checks | Missing environment variables | Verify Secrets Manager replication |
| DNS not failing over | Health check threshold too high | Lower TTL, adjust health check interval |
| Application errors in DR | Hardcoded primary region references | Audit environment variables, use region-agnostic configuration |

---

## 11. Validation Checklist

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

- [ ] **Verify Database Connectivity**: Confirm database connections are stable:
  ```bash
  curl -i http://localhost:3001/ready | jq '.checks.database'
  ```

- [ ] **Verify Redis Connectivity**: Confirm cache is accessible:
  ```bash
  curl -i http://localhost:3001/ready | jq '.checks.redis'
  ```

---

## 12. Escalation Path

If an incident cannot be resolved using this runbook:

1.  **Notify Core Maintainers**: Reference contacts in [docs/TRIAGE.md](TRIAGE.md#escalation-process).
2.  **Security Incidents**: For vulnerabilities or funds compromise, follow the private escalation channel details in [docs/TRIAGE.md](TRIAGE.md#security-triage) instead of public issue trackers.
3.  **Stellar Network Inquiries**: If issues stem from upstream Stellar network failures, consult the official [Stellar Status Dashboard](https://status.stellar.org/).
4.  **AWS Support**: For infrastructure-level issues, open a support case with AWS. Reference the Severity levels defined in your AWS Support plan.

---

## Appendix A: DR Infrastructure Commands Reference

### Quick Reference Commands

```bash
# Check primary region status
aws rds describe-db-instances --db-instance-identifier stellar-portfolio-primary-db --region us-east-1

# Check DR region status
aws rds describe-db-instances --db-instance-identifier stellar-portfolio-dr-db --region us-west-2

# Check ECS service status
aws ecs describe-services --cluster <cluster-name> --services <service-name> --region <region>

# Check Route53 health
aws route53 get-health-check-status --health-check-id <health-check-id>

# Force DNS failover
aws route53 update-health-check --health-check-id <health-check-id> --disabled

# Enable DNS failover
aws route53 update-health-check --health-check-id <health-check-id> --enable-health-check
```

### Environment Variables for DR

| Variable | Description | Example |
|---|---|---|
| `DR_REGION` | Disaster recovery region | `us-west-2` |
| `PRIMARY_REGION` | Primary region | `us-east-1` |
| `FAILOVER_MODE` | Failover mode (auto/manual) | `auto` |
| `DR_DATABASE_ENDPOINT` | DR database endpoint | `stellar-portfolio-dr-db.xxx.us-west-2.rds.amazonaws.com` |

---

## Appendix B: DR Terraform Module

For deploying the DR infrastructure, refer to the terraform modules in `deployment/terraform/modules/`. Key variables for DR deployment:

```hcl
# DR Region Deployment
terraform {
  backend "s3" {
    bucket = "stellar-portfolio-terraform-state"
    key    = "dr/terraform.tfstate"
    region = "us-east-1"
  }
}

# DR-specific variables
variable "dr_region" {
  description = "DR region"
  type        = string
  default     = "us-west-2"
}

variable "enable_cross_region_replication" {
  description = "Enable cross-region RDS replication"
  type        = bool
  default     = true
}

variable "dr_instance_class" {
  description = "DR region RDS instance class"
  type        = string
  default     = "db.t4g.small"
}
```

---

*Last Updated: $(date +"%Y-%m-%d")*
*Document Owner: Platform Team*
*Review Cycle: Quarterly*
