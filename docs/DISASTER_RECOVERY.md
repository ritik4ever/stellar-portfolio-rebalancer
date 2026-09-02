# Disaster Recovery Runbook

This runbook describes the procedures for detecting, containing, rolling back, restoring, and validating outages across the smart contract, backend (database, queues, and API), and frontend components. It includes multi-region failover procedures aligned to the new `dr_multi_region` Terraform module.

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

Our infrastructure strategy aims to meet the following Recovery Time Objective (RTO) and Recovery Point Objective (RPO) targets:

| Component | RTO | RPO | Infrastructure Support |
|---|---|---|---|
| **Database (RDS)** | 30 minutes | 5 minutes | Multi-AZ + Cross-Region Replication |
| **Backend API** | 15 minutes | N/A (stateless) | Multi-Region ECS Deployment |
| **Redis Cache** | 5 minutes | 0 (ephemeral) | Cross-Region Replication Group |
| **Frontend** | 5 minutes | N/A | Global CloudFront CDN |

*Note: Infrastructure capabilities are currently being upgraded to support these targets via the `dr_multi_region` Terraform module.*

---

## 2.2 Redis Availability-Zone Failover (ElastiCache)

Before any cross-region step is considered, a **single-AZ** Redis event is handled automatically by ElastiCache:

- The replication group runs with **Multi-AZ + automatic failover** enabled and at least one read replica in a different AZ
  (`deployment/terraform/modules/elasticache`).
- On loss of the primary node **or its entire AZ**, ElastiCache promotes a replica in another AZ and repoints the
  replication-group endpoint DNS at it.
- **RTO:** seconds to a couple of minutes (writes fail during the switchover; reads continue via replicas).
  **RPO:** the last replicated write — ElastiCache replication is asynchronous, so a small amount of data may be lost.
- **Action required:** none. The endpoint name is unchanged, so the backend reconnects on its own using the bounded-backoff
  settings in `backend/src/config/redisConnectionOptions.ts`.

Escalate to the multi-region procedures below only when the **whole region** is unavailable.

## 3. Infrastructure Overview

The multi-region architecture utilizes the `dr_multi_region` Terraform module to orchestrate:

1. **RDS**: Cross-region asynchronous replication.
2. **ElastiCache**: Cross-region global datastore.
3. **ECS**: Standby capacity in DR region.
4. **Route53**: Health-check-based failover.

---

## 8. Multi-Region Failover Procedures

This section details failover using the `dr_multi_region` Terraform module.

### 8.1 Failover Checklist

- [ ] Confirm primary region is unresponsive via health checks.
- [ ] Verify database cross-region replication lag is minimal (< 5 mins).
- [ ] Initiate database promotion in DR region using the Terraform module output.
- [ ] Scale up DR ECS services.
- [ ] Trigger Route53 failover routing.

### 8.2 Execution Steps

1. **Promote DR Database**:
   ```bash
   # Run the promotion script aligned with DR module outputs
   ./scripts/dr/promote-db.sh --region us-west-2
   ```

2. **Scale ECS Services**:
   ```bash
   # Use Terraform to update desired capacity in DR
   terraform -chdir=deployment/terraform/dr-region apply -var="ecs_desired_count=2"
   ```

3. **Update Route53**:
   ```bash
   # Execute DNS switch
   ./scripts/dr/switch-dns.sh --target dr
   ```

---

## 9. Failback Procedures

### 9.1 Failback Checklist

- [ ] Confirm primary region is recovered and stabilized.
- [ ] Sync data from DR to Primary.
- [ ] Scale down DR infrastructure.
- [ ] Revert DNS to Primary.

### 9.2 Execution Steps

1. **Re-sync Data**:
   ```bash
   # Use AWS DMS or manual pg_dump sync
   ./scripts/dr/sync-data.sh --from dr --to primary
   ```

2. **Revert DNS**:
   ```bash
   ./scripts/dr/switch-dns.sh --target primary
   ```

---

## 10. Failover Test Procedure

Testing should be performed in the staging environment quarterly.

### 10.1 Safe Test Procedure (No Impact)

1. Deploy DR infrastructure in Staging using Terraform.
2. Run a dry-run of the failover script:
   ```bash
   ./scripts/dr/failover.sh --dry-run
   ```
3. Verify that the script identifies all components correctly.
4. Do NOT execute DNS switch in production without a maintenance window.

---
*Last Updated: 2026-08-31*
*Document Owner: Platform Team*
*Review Cycle: Quarterly*
