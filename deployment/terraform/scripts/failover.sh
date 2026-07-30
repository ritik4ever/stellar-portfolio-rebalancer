#!/bin/bash

# ==============================================================================
# Stellar Portfolio Rebalancer - Multi-Region DR Failover Helper Script
# ==============================================================================
# Promotes secondary RDS read replica to standalone primary and scales secondary
# ECS tasks to execute disaster recovery failover.
# ==============================================================================

set -euo pipefail

SECONDARY_REGION="${SECONDARY_REGION:-us-west-2}"
DB_INSTANCE_ID="${DB_INSTANCE_ID:-portfolio-postgres-dr}"
ECS_CLUSTER="${ECS_CLUSTER:-portfolio-ecs-dr}"
ECS_SERVICE="${ECS_SERVICE:-portfolio-backend-dr}"
DESIRED_COUNT="${DESIRED_COUNT:-3}"
DRY_RUN="false"

usage() {
    echo "Usage: $0 [options]"
    echo "Options:"
    echo "  --region <region>          Secondary DR AWS region (default: us-west-2)"
    echo "  --db-instance <id>         Secondary RDS Instance ID (default: portfolio-postgres-dr)"
    echo "  --ecs-cluster <cluster>    Secondary ECS Cluster Name (default: portfolio-ecs-dr)"
    echo "  --ecs-service <service>    Secondary ECS Service Name (default: portfolio-backend-dr)"
    echo "  --desired-count <count>    Target ECS task count (default: 3)"
    echo "  --dry-run                  Simulate actions without modifying infrastructure"
    echo "  --help                     Show this help message"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --region)
            SECONDARY_REGION="$2"
            shift 2
            ;;
        --db-instance)
            DB_INSTANCE_ID="$2"
            shift 2
            ;;
        --ecs-cluster)
            ECS_CLUSTER="$2"
            shift 2
            ;;
        --ecs-service)
            ECS_SERVICE="$2"
            shift 2
            ;;
        --desired-count)
            DESIRED_COUNT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN="true"
            shift 1
            ;;
        --help)
            usage
            ;;
        *)
            echo "Unknown argument: $1"
            usage
            ;;
    esac
done

echo "================================================================="
echo "🚨 STARTING DISASTER RECOVERY FAILOVER TO SECONDARY REGION 🚨"
echo "================================================================="
echo "Target Region:      ${SECONDARY_REGION}"
echo "RDS DB Instance:    ${DB_INSTANCE_ID}"
echo "ECS Cluster:        ${ECS_CLUSTER}"
echo "ECS Service:        ${ECS_SERVICE}"
echo "Desired ECS Tasks:  ${DESIRED_COUNT}"
echo "Dry Run Mode:       ${DRY_RUN}"
echo "================================================================="

if [ "${DRY_RUN}" = "true" ]; then
    echo "[DRY RUN] Would promote RDS read replica ${DB_INSTANCE_ID} in region ${SECONDARY_REGION}"
    echo "[DRY RUN] Would scale ECS service ${ECS_SERVICE} in cluster ${ECS_CLUSTER} to ${DESIRED_COUNT} tasks"
    echo "[DRY RUN] Failover simulation complete."
    exit 0
fi

echo "1) Promoting RDS Read Replica in secondary region..."
aws rds promote-read-replica \
    --region "${SECONDARY_REGION}" \
    --db-instance-identifier "${DB_INSTANCE_ID}" || {
        echo "⚠️  Failed or replica already promoted. Checking status..."
    }

echo "2) Scaling secondary ECS Fargate tasks..."
aws ecs update-service \
    --region "${SECONDARY_REGION}" \
    --cluster "${ECS_CLUSTER}" \
    --service "${ECS_SERVICE}" \
    --desired-count "${DESIRED_COUNT}"

echo "3) Waiting for secondary RDS instance to reach available status..."
aws rds wait db-instance-available \
    --region "${SECONDARY_REGION}" \
    --db-instance-identifier "${DB_INSTANCE_ID}"

echo "================================================================="
echo "✅ DISASTER RECOVERY FAILOVER INITIATED SUCCESSFULLY"
echo "Next steps:"
echo "  1) Update Route53 / Ingress endpoint records to secondary region"
echo "  2) Monitor application health endpoints at secondary URL"
echo "================================================================="
