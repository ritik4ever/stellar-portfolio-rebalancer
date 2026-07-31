resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis-sg"
  description = "Security group for Redis"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name_prefix}-redis-subnet-group"
  subnet_ids = var.subnet_ids
}

resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name                    = "${var.name_prefix}-redis-auth-token"
  description             = "Redis AUTH token for ElastiCache cluster"
  recovery_window_in_days = 0

  tags = {
    Name = "${var.name_prefix}-redis-auth-token"
  }
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = jsonencode({
    auth_token = random_password.redis_auth.result
  })
}

resource "aws_secretsmanager_secret_rotation" "redis_auth" {
  secret_id           = aws_secretsmanager_secret.redis_auth.id
  rotation_lambda_arn = var.secret_rotation_lambda_arn

  rotation_rules {
    automatically_after_days = var.secret_rotation_days
  }
}

resource "aws_elasticache_cluster" "main" {
  cluster_id                 = "${var.name_prefix}-redis"
  engine                     = "redis"
  node_type                  = var.node_type
  num_cache_nodes            = 1
  parameter_group_name       = "default.redis7"
  engine_version             = "7.0"
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  transit_encryption_enabled = var.transit_encryption_enabled
  auth_token                 = var.auth_token_enabled ? random_password.redis_auth.result : null

  tags = {
    Name = "${var.name_prefix}-redis"
  }
}
