# ------------------------------------------------------------------------------
# PRIMARY REGION MODULE
# ------------------------------------------------------------------------------

# VPC
resource "aws_vpc" "primary" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.app_name}-${var.environment}-primary-vpc"
  }
}

resource "aws_subnet" "primary_public_a" {
  vpc_id                  = aws_vpc.primary.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.primary_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-${var.environment}-primary-pub-a"
  }
}

resource "aws_subnet" "primary_public_b" {
  vpc_id                  = aws_vpc.primary.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.primary_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-${var.environment}-primary-pub-b"
  }
}

resource "aws_subnet" "primary_private_a" {
  vpc_id            = aws_vpc.primary.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "${var.primary_region}a"

  tags = {
    Name = "${var.app_name}-${var.environment}-primary-priv-a"
  }
}

resource "aws_subnet" "primary_private_b" {
  vpc_id            = aws_vpc.primary.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "${var.primary_region}b"

  tags = {
    Name = "${var.app_name}-${var.environment}-primary-priv-b"
  }
}

resource "aws_db_subnet_group" "primary" {
  name       = "${var.app_name}-${var.environment}-primary-db-subnets"
  subnet_ids = [aws_subnet.primary_private_a.id, aws_subnet.primary_private_b.id]

  tags = {
    Name = "${var.app_name}-${var.environment}-primary-db-subnets"
  }
}

# Primary RDS PostgreSQL DB Instance
resource "aws_db_instance" "primary" {
  identifier                  = "${var.app_name}-postgres-primary"
  engine                      = "postgres"
  engine_version              = "15.4"
  instance_class              = "db.t4g.small"
  allocated_storage           = 20
  max_allocated_storage       = 100
  db_name                     = var.db_name
  username                    = var.db_user
  password                    = var.db_password
  db_subnet_group_name        = aws_db_subnet_group.primary.name
  backup_retention_period     = 7
  backup_window               = "03:00-04:00"
  maintenance_window          = "Mon:04:30-Mon:05:30"
  auto_minor_version_upgrade  = true
  skip_final_snapshot         = true
  deletion_protection         = false

  tags = {
    Name = "${var.app_name}-postgres-primary"
    Role = "PrimaryDatabase"
  }
}

# Primary Redis Replication Group
resource "aws_elasticache_subnet_group" "primary" {
  name       = "${var.app_name}-${var.environment}-primary-redis-subnets"
  subnet_ids = [aws_subnet.primary_private_a.id, aws_subnet.primary_private_b.id]
}

resource "aws_elasticache_replication_group" "primary" {
  replication_group_id = "${var.app_name}-redis-primary"
  description          = "Primary Redis Cluster"
  node_type            = "cache.t4g.micro"
  num_cache_clusters   = 2
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.primary.name
  automatic_failover_enabled = true

  tags = {
    Name = "${var.app_name}-redis-primary"
  }
}

# Primary ECS Cluster & Service
resource "aws_ecs_cluster" "primary" {
  name = "${var.app_name}-ecs-primary"

  tags = {
    Name = "${var.app_name}-ecs-primary"
  }
}

resource "aws_ecs_task_definition" "primary" {
  family                   = "${var.app_name}-backend-primary"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "stellar-portfolio-backend:latest"
      essential = true
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
        }
      ]
      environment = [
        { name = "NODE_ENV", value = var.environment }
      ]
    }
  ])
}

resource "aws_ecs_service" "primary" {
  name            = "${var.app_name}-backend-primary"
  cluster         = aws_ecs_cluster.primary.id
  task_definition = aws_ecs_task_definition.primary.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.primary_public_a.id, aws_subnet.primary_public_b.id]
    assign_public_ip = true
  }
}

# Primary S3 Bucket with Cross-Region Replication (CRR) support
resource "aws_s3_bucket" "primary" {
  bucket = "${var.app_name}-${var.environment}-primary-data"
}

resource "aws_s3_bucket_versioning" "primary" {
  bucket = aws_s3_bucket.primary.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_iam_role" "replication" {
  name = "${var.app_name}-s3-crr-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "replication" {
  name = "${var.app_name}-s3-crr-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Effect   = "Allow"
        Resource = [aws_s3_bucket.primary.arn]
      },
      {
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Effect   = "Allow"
        Resource = ["${aws_s3_bucket.primary.arn}/*"]
      },
      {
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Effect   = "Allow"
        Resource = var.dr_s3_bucket_arn != "" ? ["${var.dr_s3_bucket_arn}/*"] : ["*"]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "replication" {
  role       = aws_iam_role.replication.name
  policy_arn = aws_iam_policy.replication.arn
}

resource "aws_s3_bucket_replication_configuration" "primary" {
  count = var.dr_s3_bucket_arn != "" ? 1 : 0

  depends_on = [aws_s3_bucket_versioning.primary]
  role       = aws_iam_role.replication.arn
  bucket     = aws_s3_bucket.primary.id

  rule {
    id     = "CrossRegionReplicationRule"
    status = "Enabled"

    destination {
      bucket        = var.dr_s3_bucket_arn
      storage_class = "STANDARD"
    }
  }
}
