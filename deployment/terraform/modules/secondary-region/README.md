# Secondary Region DR Terraform Module

This module provisions a minimal set of DR resources in a secondary AWS region: an ECS cluster, an RDS read-replica (cross-region), Redis placeholder, and S3 replica buckets. It is intentionally minimal — specific production settings (subnet groups, parameter groups, KMS keys, and IAM roles) should be supplied by callers or wrapped by higher-level modules.

Variables:
- `secondary_region` - target AWS region for DR resources
- `primary_db_identifier` - identifier or ARN of the primary RDS instance to replicate from
- `s3_buckets` - list of S3 bucket names to replicate (module creates destination buckets in DR region)

Failover:
See the failover script at `scripts/failover.sh` for a manual promotion path. The scripted approach uses `aws rds promote-read-replica` and Route53 updates to switch traffic. Test promotions in a controlled environment before relying on them in production.
