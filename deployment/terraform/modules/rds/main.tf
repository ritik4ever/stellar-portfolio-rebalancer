resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds-sg"
  description = "Security group for RDS"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    cidr_blocks     = ["10.0.0.0/16"] # Allow access from VPC
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
  skip_final_snapshot         = true
  publicly_accessible         = false

  # Automated backup retention — kept for fast point-in-time recovery (#1484).
  backup_retention_period = var.backup_retention_days
  backup_window           = "03:00-04:00"

  tags = {
    Name        = "${var.name_prefix}-db"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ── AWS Backup plan for long-term snapshot retention and auto-pruning (#1484) ─

resource "aws_backup_vault" "rds" {
  name = "${var.name_prefix}-rds-backup-vault"

  tags = {
    Name        = "${var.name_prefix}-rds-backup-vault"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_backup_plan" "rds" {
  name = "${var.name_prefix}-rds-backup-plan"

  rule {
    rule_name         = "daily-snapshot"
    target_vault_name = aws_backup_vault.rds.name
    # Run the snapshot at 02:00 UTC daily, outside the RDS backup window.
    schedule = "cron(0 2 * * ? *)"

    lifecycle {
      cold_storage_after = var.snapshot_cold_storage_after_days > 0 ? var.snapshot_cold_storage_after_days : null
      delete_after       = var.snapshot_delete_after_days
    }

    recovery_point_tags = {
      Environment = var.environment
      ManagedBy   = "aws-backup"
      # Date is injected by AWS Backup at recovery-point creation time via
      # the aws:backup:source-resource-arn tag — we set project metadata here.
      Project = "stellar-portfolio-rebalancer"
    }
  }

  tags = {
    Name        = "${var.name_prefix}-rds-backup-plan"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# IAM role that allows AWS Backup to snapshot the RDS instance.
resource "aws_iam_role" "backup" {
  name = "${var.name_prefix}-backup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "backup.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "${var.name_prefix}-backup-role"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

# Assign the backup plan to the RDS instance.
resource "aws_backup_selection" "rds" {
  iam_role_arn = aws_iam_role.backup.arn
  name         = "${var.name_prefix}-rds-backup-selection"
  plan_id      = aws_backup_plan.rds.id

  resources = [aws_db_instance.main.arn]
}
