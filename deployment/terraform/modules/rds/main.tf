resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds-sg"
  description = "Security group for RDS"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"] # Allow access from VPC
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-rds-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.name_prefix}-rds-subnet-group"
  }
}

resource "aws_db_instance" "main" {
  identifier                  = "${var.name_prefix}-db"
  engine                      = "postgres"
  engine_version              = "15.4"
  instance_class              = var.instance_class
  allocated_storage           = 20
  storage_type                = "gp3"
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.rds.id]
  db_name                     = "stellar_portfolio"
  username                    = "dbadmin"
  manage_master_user_password = true # Stores password in Secrets Manager automatically
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.name_prefix}-db-final"
  publicly_accessible         = false

  # Automated backups: RDS takes a daily snapshot and retains
  # backup_retention_period worth of them, enabling point-in-time recovery.
  backup_retention_period = var.backup_retention_period
  backup_window           = var.backup_window
  copy_tags_to_snapshot   = true

  tags = {
    Name = "${var.name_prefix}-db"
  }
}

resource "aws_secretsmanager_secret_rotation" "main" {
  secret_id           = aws_db_instance.main.master_user_secret[0].secret_arn
  rotation_lambda_arn = var.secret_rotation_lambda_arn

  rotation_rules {
    automatically_after_days = var.secret_rotation_days
  }
}

# -----------------------------------------------------------------------------
# Automated snapshot retention
#
# RDS automated backups only cover the retention window above. This Lambda
# prunes *manual* snapshots that fall outside the window, so long-lived manual
# snapshots (e.g. taken before risky changes) do not accumulate forever.
#
# Safety model:
#   - Only snapshots tagged SnapshotOwner = var.name_prefix are considered.
#   - Snapshots without that exact tag are never touched.
#   - Snapshots newer than the retention window are always kept.
#   - The instance-termination final snapshot (FINAL_SNAPSHOT identifier) is
#     ignored regardless of age.
# -----------------------------------------------------------------------------
resource "aws_iam_role" "snapshot_retention" {
  name = "${var.name_prefix}-rds-snapshot-retention"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "${var.name_prefix}-rds-snapshot-retention"
  }
}

resource "aws_iam_role_policy" "snapshot_retention" {
  name = "snapshot-retention"
  role = aws_iam_role.snapshot_retention.id

  # Least privilege: describe + delete only, scoped to this account.
  # Resource-level restriction is not possible for rds:DeleteDBSnapshot,
  # so the Lambda itself enforces tag-based scoping (see the function code).
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.snapshot_retention.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["rds:DescribeDBSnapshots", "rds:DeleteDBSnapshot", "rds:AddTagsToResource", "rds:ListTagsForResource"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "snapshot_retention" {
  name              = "/aws/lambda/${var.name_prefix}-rds-snapshot-retention"
  retention_in_days = 14

  tags = {
    Name = "${var.name_prefix}-rds-snapshot-retention"
  }
}

resource "aws_lambda_function" "snapshot_retention" {
  function_name = "${var.name_prefix}-rds-snapshot-retention"
  role          = aws_iam_role.snapshot_retention.arn
  runtime       = "nodejs20.x"
  handler       = "snapshot-retention.handler"
  timeout       = 300
  memory_size   = 128

  # Deployment package is built by Terraform itself (archive_file below) —
  # no manual upload or packaging step exists.
  filename         = data.archive_file.snapshot_retention.output_path
  source_code_hash = data.archive_file.snapshot_retention.output_base64sha256

  environment {
    variables = {
      SNAPSHOT_OWNER = var.name_prefix
      ENVIRONMENT    = var.environment
      RETENTION_DAYS = tostring(var.backup_retention_period)
      FINAL_SNAPSHOT = "${var.name_prefix}-db-final"
    }
  }

  tags = {
    Name = "${var.name_prefix}-rds-snapshot-retention"
  }
}

data "archive_file" "snapshot_retention" {
  type        = "zip"
  source_file = "${path.module}/lambda/snapshot-retention.mjs"
  output_path = "${path.module}/lambda/snapshot-retention.zip"
}

resource "aws_cloudwatch_event_rule" "snapshot_retention" {
  name                = "${var.name_prefix}-rds-snapshot-retention"
  description         = "Daily cleanup of RDS manual snapshots past the retention window"
  schedule_expression = var.snapshot_cleanup_schedule

  tags = {
    Name = "${var.name_prefix}-rds-snapshot-retention"
  }
}

resource "aws_cloudwatch_event_target" "snapshot_retention" {
  rule = aws_cloudwatch_event_rule.snapshot_retention.name
  arn  = aws_lambda_function.snapshot_retention.arn
}

resource "aws_lambda_permission" "snapshot_retention" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.snapshot_retention.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.snapshot_retention.arn
}

resource "aws_cloudwatch_metric_alarm" "snapshot_retention_errors" {
  alarm_name          = "${var.name_prefix}-rds-snapshot-retention-errors"
  alarm_description   = "Snapshot retention Lambda failed on one or more invocations"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  period              = 86400
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.snapshot_retention.function_name
  }

  tags = {
    Name = "${var.name_prefix}-rds-snapshot-retention-errors"
  }
}
