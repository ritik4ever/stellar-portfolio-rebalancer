# ─── AWS Secrets Manager Rotation Lambda Module ───────────────────────────────
#
# This module creates two rotation Lambda functions:
#
#   1. rds_rotation_lambda  – Uses the AWS-managed SecretsManager rotation
#      Lambda for RDS PostgreSQL (single-user strategy).  It is deployed as a
#      Serverless Application Repository (SAR) application so that AWS
#      maintains the Lambda code.
#
#   2. redis_rotation_lambda – A lightweight custom Lambda that generates a new
#      random AUTH token, writes it to Secrets Manager, and updates the
#      ElastiCache replication group in-place using the two-step MODIFY flow
#      required to avoid downtime (add new token, remove old token).
#
# Both Lambdas are placed inside the VPC so they can reach the database and
# cache endpoints over private networking.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.0"
    }
  }
}

# ─── Data sources ─────────────────────────────────────────────────────────────

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ─── RDS rotation Lambda (AWS Serverless Application Repository) ─────────────
# AWS publishes a managed rotation Lambda for Postgres single-user rotation.
# We deploy it via the SAR to avoid managing Lambda code ourselves.

resource "aws_serverlessapplicationrepository_cloudformation_stack" "rds_rotation" {
  count          = var.enable_rds_rotation ? 1 : 0
  name           = "${var.name_prefix}-rds-secret-rotation"
  application_id = "arn:aws:serverlessrepo:us-east-1:297356227824:applications/SecretsManagerRDSPostgreSQLRotationSingleUser"
  # Use the latest semantic version available in the SAR; pin in production.
  semantic_version = var.rds_rotation_sar_version
  capabilities     = ["CAPABILITY_IAM", "CAPABILITY_RESOURCE_POLICY"]

  parameters = {
    endpoint            = "https://secretsmanager.${data.aws_region.current.name}.amazonaws.com"
    functionName        = "${var.name_prefix}-rds-rotation"
    vpcSecurityGroupIds = var.rotation_sg_id
    vpcSubnetIds        = join(",", var.private_subnet_ids)
  }

  tags = {
    Name        = "${var.name_prefix}-rds-rotation"
    ManagedBy   = "Terraform"
    Environment = var.name_prefix
  }
}

# Derive the Lambda ARN from the SAR stack outputs
locals {
  rds_rotation_lambda_arn = (
    var.enable_rds_rotation
    ? aws_serverlessapplicationrepository_cloudformation_stack.rds_rotation[0].outputs["RotationLambdaARN"]
    : null
  )
}

# ─── Security group for rotation Lambdas ─────────────────────────────────────
# Rotation Lambdas need outbound HTTPS to Secrets Manager and inbound-free.

resource "aws_security_group" "rotation_lambda" {
  name        = "${var.name_prefix}-rotation-lambda-sg"
  description = "Security group for Secrets Manager rotation Lambdas"
  vpc_id      = var.vpc_id

  # Allow rotation Lambda to reach Secrets Manager endpoint (HTTPS)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS to AWS Secrets Manager service endpoint"
  }

  # Allow rotation Lambda to reach RDS (PostgreSQL)
  egress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "PostgreSQL to RDS within VPC"
  }

  # Allow rotation Lambda to reach ElastiCache (Redis)
  egress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "Redis to ElastiCache within VPC"
  }

  tags = {
    Name      = "${var.name_prefix}-rotation-lambda-sg"
    ManagedBy = "Terraform"
  }
}

# ─── Redis rotation Lambda ────────────────────────────────────────────────────
# Custom Lambda: generates a new AUTH token, updates Secrets Manager, then
# calls ElastiCache ModifyReplicationGroup with the new token.

data "archive_file" "redis_rotation" {
  count       = var.enable_redis_rotation ? 1 : 0
  type        = "zip"
  output_path = "${path.module}/redis_rotation.zip"

  source {
    content  = file("${path.module}/redis_rotation_handler.py")
    filename = "handler.py"
  }
}

resource "aws_iam_role" "redis_rotation_lambda" {
  count = var.enable_redis_rotation ? 1 : 0
  name  = "${var.name_prefix}-redis-rotation-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "redis_rotation_lambda" {
  count = var.enable_redis_rotation ? 1 : 0
  name  = "${var.name_prefix}-redis-rotation-policy"
  role  = aws_iam_role.redis_rotation_lambda[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecretsManagerRotation"
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage",
        ]
        Resource = var.redis_secret_arn
      },
      {
        Sid    = "ElastiCacheModify"
        Effect = "Allow"
        Action = [
          "elasticache:DescribeReplicationGroups",
          "elasticache:ModifyReplicationGroup",
        ]
        Resource = "*"
      },
      {
        Sid    = "VPCAccess"
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
        ]
        Resource = "*"
      },
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
    ]
  })
}

resource "aws_lambda_function" "redis_rotation" {
  count            = var.enable_redis_rotation ? 1 : 0
  function_name    = "${var.name_prefix}-redis-rotation"
  role             = aws_iam_role.redis_rotation_lambda[0].arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 30
  filename         = data.archive_file.redis_rotation[0].output_path
  source_code_hash = data.archive_file.redis_rotation[0].output_base64sha256
  description      = "Rotates the Redis AUTH token in Secrets Manager and updates ElastiCache"

  environment {
    variables = {
      REDIS_REPLICATION_GROUP_ID = var.redis_replication_group_id
      SECRET_ARN                 = var.redis_secret_arn
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.rotation_lambda.id]
  }

  tags = {
    Name      = "${var.name_prefix}-redis-rotation"
    ManagedBy = "Terraform"
  }

  depends_on = [aws_iam_role_policy.redis_rotation_lambda]
}

# Allow Secrets Manager to invoke the Redis rotation Lambda
resource "aws_lambda_permission" "redis_rotation_secretsmanager" {
  count         = var.enable_redis_rotation ? 1 : 0
  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.redis_rotation[0].function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = var.redis_secret_arn
}
