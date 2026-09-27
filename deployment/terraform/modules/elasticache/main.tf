locals {
  # Total number of nodes in the replication group: one primary plus
  # `replica_count` read replicas.
  node_count = var.replica_count + 1

  # ElastiCache allocates nodes in the order of this list: index 0 becomes the
  # primary, every entry after it becomes a read replica.  Cycling through the
  # AZ pool guarantees each node — and critically at least one read replica —
  # is provisioned in a *different* availability zone from the primary, which
  # is what makes an AZ-level outage survivable.
  preferred_azs = [
    for i in range(local.node_count) : var.availability_zones[i % length(var.availability_zones)]
  ]

  # Multi-AZ cannot be turned on without automatic failover, and the module's
  # validation blocks `multi_az_enabled` when `automatic_failover_enabled`
  # is false.  A replica also implies failover, so `replica_count >= 1`
  # (enforced by validation) keeps this true in every supported combination.
  failover_enabled = var.multi_az_enabled || var.automatic_failover_enabled
}

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
  description             = "Redis AUTH token for ElastiCache replication group"
  recovery_window_in_days = 0

  tags = {
    Name = "${var.name_prefix}-redis-auth-token"
  }
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id = aws_secretsmanager_secret.redis_auth.id
  secret_string = jsonencode({
    auth_token = random_password.redis_auth.result
  })
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "Redis replication group for ${var.name_prefix}"
  engine               = "redis"
  engine_version       = "7.0"
  node_type            = var.node_type
  port                 = 6379
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  # ─── High availability ────────────────────────────────────────────────────
  # One primary + `replica_count` read replicas, pinned to distinct AZs so a
  # single-AZ outage cannot take down Redis.
  num_cache_clusters          = local.node_count
  preferred_cache_cluster_azs = local.preferred_azs

  # Multi-AZ with automatic failover: if the primary node *or its whole
  # availability zone* becomes unavailable, ElastiCache promotes a read
  # replica from another AZ and repoints the primary (and reader) endpoint
  # DNS record at the promoted node.  Clients keep using the same
  # replication-group endpoint and simply reconnect — see README.md.
  automatic_failover_enabled = local.failover_enabled
  multi_az_enabled           = var.multi_az_enabled
  # --------------------------------------------------------------------------

  transit_encryption_enabled = var.transit_encryption_enabled
  at_rest_encryption_enabled = var.at_rest_encryption_enabled
  auth_token                 = var.auth_token_enabled ? random_password.redis_auth.result : null
  apply_immediately          = var.apply_immediately

  lifecycle {
    precondition {
      condition     = !var.multi_az_enabled || local.node_count >= 2
      error_message = "Multi-AZ requires at least one read replica (replica_count >= 1)."
    }
  }

  tags = {
    Name = "${var.name_prefix}-redis"
  }
}
