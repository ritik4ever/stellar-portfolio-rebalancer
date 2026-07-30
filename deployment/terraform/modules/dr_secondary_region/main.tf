# ------------------------------------------------------------------------------
# SECONDARY DR REGION MODULE
# ------------------------------------------------------------------------------

# Secondary DR VPC
resource "aws_vpc" "secondary" {
  cidr_block           = "10.1.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.app_name}-${var.environment}-dr-vpc"
  }
}

resource "aws_subnet" "secondary_public_a" {
  vpc_id                  = aws_vpc.secondary.id
  cidr_block              = "10.1.1.0/24"
  availability_zone       = "${var.secondary_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-${var.environment}-dr-pub-a"
  }
}

resource "aws_subnet" "secondary_public_b" {
  vpc_id                  = aws_vpc.secondary.id
  cidr_block              = "10.1.2.0/24"
  availability_zone       = "${var.secondary_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-${var.environment}-dr-pub-b"
  }
}

resource "aws_subnet" "secondary_private_a" {
  vpc_id            = aws_vpc.secondary.id
  cidr_block        = "10.1.10.0/24"
  availability_zone = "${var.secondary_region}a"

  tags = {
    Name = "${var.app_name}-${var.environment}-dr-priv-a"
  }
}

resource "aws_subnet" "secondary_private_b" {
  vpc_id            = aws_vpc.secondary.id
  cidr_block        = "10.1.11.0/24"
  availability_zone = "${var.secondary_region}b"

  tags = {
    Name = "${var.app_name}-${var.environment}-dr-priv-b"
  }
}

resource "aws_db_subnet_group" "secondary" {
  name       = "${var.app_name}-${var.environment}-dr-db-subnets"
  subnet_ids = [aws_subnet.secondary_private_a.id, aws_subnet.secondary_private_b.id]

  tags = {
    Name = "${var.app_name}-${var.environment}-dr-db-subnets"
  }
}

# Cross-Region RDS Read Replica (Promotable for DR)
resource "aws_db_instance" "dr_replica" {
  identifier           = "${var.app_name}-postgres-dr"
  replicate_source_db  = var.primary_db_instance_arn
  instance_class       = "db.t4g.small"
  auto_minor_version_upgrade = true
  skip_final_snapshot  = true
  db_subnet_group_name = aws_db_subnet_group.secondary.name

  tags = {
    Name = "${var.app_name}-postgres-dr"
    Role = "DisasterRecoveryReadReplica"
  }
}

# Secondary Redis Cluster
resource "aws_elasticache_subnet_group" "secondary" {
  name       = "${var.app_name}-${var.environment}-dr-redis-subnets"
  subnet_ids = [aws_subnet.secondary_private_a.id, aws_subnet.secondary_private_b.id]
}

resource "aws_elasticache_replication_group" "secondary" {
  replication_group_id = "${var.app_name}-redis-dr"
  description          = "Secondary DR Redis Cluster"
  node_type            = "cache.t4g.micro"
  num_cache_clusters   = 1
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.secondary.name

  tags = {
    Name = "${var.app_name}-redis-dr"
  }
}

# Standby DR ECS Cluster & Service
resource "aws_ecs_cluster" "secondary" {
  name = "${var.app_name}-ecs-dr"

  tags = {
    Name = "${var.app_name}-ecs-dr"
  }
}

resource "aws_ecs_task_definition" "secondary" {
  family                   = "${var.app_name}-backend-dr"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([
    {
      name      = "backend-dr"
      image     = "stellar-portfolio-backend:latest"
      essential = true
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
        }
      ]
      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "IS_DR_FAILOVER", value = "true" }
      ]
    }
  ])
}

resource "aws_ecs_service" "secondary" {
  name            = "${var.app_name}-backend-dr"
  cluster         = aws_ecs_cluster.secondary.id
  task_definition = aws_ecs_task_definition.secondary.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.secondary_public_a.id, aws_subnet.secondary_public_b.id]
    assign_public_ip = true
  }
}

# Secondary S3 Destination Bucket for Cross-Region Replication
resource "aws_s3_bucket" "secondary_dr" {
  bucket = "${var.app_name}-${var.environment}-dr-data"
}

resource "aws_s3_bucket_versioning" "secondary_dr" {
  bucket = aws_s3_bucket.secondary_dr.id

  versioning_configuration {
    status = "Enabled"
  }
}
