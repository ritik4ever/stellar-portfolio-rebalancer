# Disaster Recovery & Multi-Region Failover Architecture

This document defines the Disaster Recovery (DR) strategy, multi-region architecture, replication mechanics, failover runbooks, and recovery testing procedures for the **Stellar Portfolio Rebalancer** platform.

---

## 1. Executive Summary & Recovery Objectives

| Metric | Target | Description |
|---|---|---|
| **RPO** (Recovery Point Objective) | **< 5 minutes** | Maximum allowable data loss measured by cross-region RDS replica lag and S3 sync delay. |
| **RTO** (Recovery Time Objective) | **< 15 minutes** | Maximum allowable downtime required to promote the DR database, scale secondary ECS tasks, and update DNS routing. |

---

## 2. Multi-Region Infrastructure Architecture

The platform uses an active-passive multi-region infrastructure model managed via Terraform (`deployment/terraform`):

```
┌────────────────────────────────────────────────────────┐     ┌────────────────────────────────────────────────────────┐
│ PRIMARY REGION (us-east-1)                             │     │ SECONDARY DR REGION (us-west-2)                        │
│                                                        │     │                                                        │
│  ┌──────────────┐         ┌─────────────────────────┐  │     │  ┌──────────────┐         ┌─────────────────────────┐  │
│  │  ECS Service │         │  RDS Primary PostgreSQL │  │────►│  │  ECS Standby │         │  RDS DR Read Replica    │  │
│  │ (Active App) │         │       (Write/Read)      │  │ Async│  │  (DR App)    │         │   (Promotable to Write) │  │
│  └──────┬───────┘         └────────────┬────────────┘  │Replication└──────┬───────┘         └─────────────────────────┘  │
│         │                              │               │     │         │                                              │
│         ▼                              ▼               │     │         ▼                                              │
│  ┌──────────────┐         ┌─────────────────────────┐  │     │  ┌──────────────┐         ┌─────────────────────────┐  │
│  │  Redis Primary│        │   S3 Primary Bucket     │  │────►│  │  Redis Standby│        │   S3 DR Dest Bucket     │  │
│  └──────────────┘         └─────────────────────────┘  │ CRR │  └──────────────┘         └─────────────────────────┘  │
└────────────────────────────────────────────────────────┘     └────────────────────────────────────────────────────────┘
```

---

## 3. Cross-Region Replication Mechanics

### A. Database (RDS PostgreSQL)
- **Primary**: Multi-AZ PostgreSQL instance deployed in the primary region (`us-east-1`).
- **DR Replica**: Promotable cross-region read replica deployed in the secondary region (`us-west-2`) using native AWS RDS asynchronous physical replication.

### B. Object Storage (S3)
- **Cross-Region Replication (CRR)**: All persistent uploads and state files stored in the primary S3 bucket are automatically replicated to the secondary region destination bucket using IAM role delegation and versioning.

### C. Container Workloads (ECS)
- **Primary**: Active ECS Fargate tasks processing user traffic.
- **Secondary**: Standby ECS Fargate cluster with minimal or baseline tasks ready to be scaled up immediately during a failover event.

---

## 4. Terraform Provisioning

The multi-region infrastructure is declared in `deployment/terraform`:

```bash
cd deployment/terraform

# Initialize Terraform
terraform init

# Validate configuration
terraform validate

# Review multi-region execution plan
terraform plan

# Apply infrastructure (Primary + Secondary DR)
terraform apply
```

---

## 5. Failover Runbook (Step-by-Step)

In the event of a catastrophic primary region outage:

### Step 1: Confirm Outage & Declare Disaster
Verify primary region unavailability via CloudWatch metrics, health endpoints, or AWS Health Dashboard.

### Step 2: Promote Secondary RDS Read Replica
Promote the secondary PostgreSQL read replica to a standalone read/write database:
```bash
aws rds promote-read-replica \
  --region us-west-2 \
  --db-instance-identifier portfolio-postgres-dr
```

### Step 3: Scale Secondary ECS Service
Scale up the secondary ECS Fargate tasks to match primary capacity:
```bash
aws ecs update-service \
  --region us-west-2 \
  --cluster portfolio-ecs-dr \
  --service portfolio-backend-dr \
  --desired-count 3
```

### Step 4: Update Routing / DNS
Point Route53 / CDN ingress traffic to the secondary region ALB or gateway endpoint.

---

## 6. Automated Failover Script

A automated failover script is provided at `deployment/terraform/scripts/failover.sh`:

```bash
# Execute automated failover to secondary region
./deployment/terraform/scripts/failover.sh --region us-west-2
```

---

## 7. Failback & Post-Incident Recovery

Once the primary region has recovered:
1. Re-establish cross-region replication from the secondary (now primary) DB to a newly provisioned instance in the primary region.
2. Synchronize S3 storage changes.
3. Switch DNS traffic back during a scheduled maintenance window.
