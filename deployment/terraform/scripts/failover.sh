#!/usr/bin/env bash
set -euo pipefail

# Simple scripted manual failover helper.
# Requirements: AWS CLI configured with permissions to manage RDS, Route53, and S3.

if [ "$#" -lt 4 ]; then
  echo "Usage: $0 <secondary-region> <read-replica-identifier> <route53-zone-id> <record-name>"
  echo "Example: $0 us-west-2 portfolio-db-dr-us-west-2 Z123EXAMPLE api.example.com"
  exit 2
fi

SECONDARY_REGION="$1"
REPLICA_ID="$2"
ZONE_ID="$3"
RECORD_NAME="$4"

echo "Promoting read replica ${REPLICA_ID} in ${SECONDARY_REGION}..."
aws rds promote-read-replica --db-instance-identifier "${REPLICA_ID}" --region "${SECONDARY_REGION}"

echo "Waiting for promotion to complete..."
aws rds wait db-instance-available --db-instance-identifier "${REPLICA_ID}" --region "${SECONDARY_REGION}"

# Obtain the endpoint of promoted instance
ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "${REPLICA_ID}" --region "${SECONDARY_REGION}" --query "DBInstances[0].Endpoint.Address" --output text)

echo "Promoted instance endpoint: ${ENDPOINT}"

echo "Updating Route53 record ${RECORD_NAME} in zone ${ZONE_ID} to point to ${ENDPOINT}..."
cat > /tmp/route53-change.json <<EOF
{
  "Comment": "Promote DR DB endpoint",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "${RECORD_NAME}",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "${ENDPOINT}"}]
      }
    }
  ]
}
EOF

aws route53 change-resource-record-sets --hosted-zone-id "${ZONE_ID}" --change-batch file:///tmp/route53-change.json

echo "Failover script completed. Verify application connectivity and re-enable write traffic as needed."
