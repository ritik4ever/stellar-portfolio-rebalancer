# Terraform native tests for the ElastiCache Multi-AZ / automatic-failover
# work. Provider calls are mocked, so the suite runs fully offline:
#
#   cd deployment/terraform/modules/elasticache && terraform test
#
# Verified behaviours: Multi-AZ + automatic failover are on by default, at
# least one read replica is pinned to a different AZ from the primary, the AZ
# pool cycles when there are more replicas than AZs, and the variable
# validation rejects combinations that would break failover.

mock_provider "aws" {}

mock_provider "random" {}

# ─── Defaults ────────────────────────────────────────────────────────────────

run "defaults_enable_multi_az_and_automatic_failover" {
  command = plan

  variables {
    name_prefix = "stellar-portfolio-staging"
    vpc_id      = "vpc-0123456789abcdef0"
    subnet_ids  = ["subnet-aaa", "subnet-bbb"]
    node_type   = "cache.t4g.micro"
  }

  assert {
    condition     = aws_elasticache_replication_group.main.multi_az_enabled == true
    error_message = "Multi-AZ must be enabled by default on the Redis replication group."
  }

  assert {
    condition     = aws_elasticache_replication_group.main.automatic_failover_enabled == true
    error_message = "Automatic failover must be enabled by default (Multi-AZ requires it)."
  }

  assert {
    condition     = aws_elasticache_replication_group.main.num_cache_clusters == 2
    error_message = "The default replication group must have 1 primary + 1 read replica (num_cache_clusters = 2)."
  }
}

run "read_replica_lands_in_a_different_az_than_the_primary" {
  command = plan

  variables {
    name_prefix = "stellar-portfolio-staging"
    vpc_id      = "vpc-0123456789abcdef0"
    subnet_ids  = ["subnet-aaa", "subnet-bbb"]
    node_type   = "cache.t4g.micro"
  }

  assert {
    condition     = length(aws_elasticache_replication_group.main.preferred_cache_cluster_azs) == 2
    error_message = "One availability zone must be pinned per node."
  }

  assert {
    condition     = aws_elasticache_replication_group.main.preferred_cache_cluster_azs[0] != aws_elasticache_replication_group.main.preferred_cache_cluster_azs[1]
    error_message = "The read replica must be provisioned in a different AZ from the primary so an AZ outage can be survived."
  }
}

# ─── Extra replicas / AZ pool cycling ────────────────────────────────────────

run "replicas_spread_across_all_configured_azs" {
  command = plan

  variables {
    name_prefix        = "stellar-portfolio-production"
    vpc_id             = "vpc-0123456789abcdef0"
    subnet_ids         = ["subnet-aaa", "subnet-bbb", "subnet-ccc"]
    node_type          = "cache.t4g.small"
    replica_count      = 2
    availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]
  }

  assert {
    condition     = aws_elasticache_replication_group.main.num_cache_clusters == 3
    error_message = "replica_count = 2 must yield 1 primary + 2 read replicas."
  }

  assert {
    condition     = aws_elasticache_replication_group.main.preferred_cache_cluster_azs == tolist(["us-east-1a", "us-east-1b", "us-east-1c"])
    error_message = "Each node must be pinned to a distinct availability zone."
  }

  assert {
    condition     = aws_elasticache_replication_group.main.multi_az_enabled == true
    error_message = "Multi-AZ must remain enabled with more than one replica."
  }
}

run "more_replicas_than_azs_cycles_the_az_pool" {
  command = plan

  variables {
    name_prefix        = "stellar-portfolio-production"
    vpc_id             = "vpc-0123456789abcdef0"
    subnet_ids         = ["subnet-aaa", "subnet-bbb"]
    node_type          = "cache.t4g.small"
    replica_count      = 4
    availability_zones = ["us-east-1a", "us-east-1b"]
  }

  assert {
    condition     = aws_elasticache_replication_group.main.num_cache_clusters == 5
    error_message = "replica_count = 4 must yield 1 primary + 4 read replicas."
  }

  assert {
    condition     = aws_elasticache_replication_group.main.preferred_cache_cluster_azs == tolist(["us-east-1a", "us-east-1b", "us-east-1a", "us-east-1b", "us-east-1a"])
    error_message = "The AZ pool must cycle so every replica still lands in a real AZ."
  }
}

# ─── Endpoint outputs point at the replication group, not a node ─────────────

run "cluster_endpoints_are_exposed_for_the_backend" {
  # `apply` (not `plan`) because the endpoint outputs embed the replication
  # group's computed DNS names, which are unknown until applied.
  command = apply

  variables {
    name_prefix = "stellar-portfolio-staging"
    vpc_id      = "vpc-0123456789abcdef0"
    subnet_ids  = ["subnet-aaa", "subnet-bbb"]
    node_type   = "cache.t4g.micro"

    # The mocked random provider returns an empty password, which the real
    # auth_token validator rejects; disabling AUTH keeps this apply-only run
    # focused on the endpoint wiring.
    auth_token_enabled = false
  }

  assert {
    condition     = endswith(output.redis_primary_endpoint, ":${aws_elasticache_replication_group.main.port}")
    error_message = "The primary output must expose the replication-group endpoint as host:port."
  }

  assert {
    condition     = endswith(output.redis_reader_endpoint, ":${aws_elasticache_replication_group.main.port}")
    error_message = "The reader output must expose the replication-group reader endpoint as host:port."
  }

  assert {
    condition     = output.node_count == 2 && output.num_cache_clusters == 2
    error_message = "The module must report the configured node count (1 primary + 1 replica)."
  }
}

# ─── Validation guards ───────────────────────────────────────────────────────

run "replica_count_must_be_at_least_one" {
  command = plan

  variables {
    name_prefix      = "stellar-portfolio-staging"
    vpc_id           = "vpc-0123456789abcdef0"
    subnet_ids       = ["subnet-aaa", "subnet-bbb"]
    node_type        = "cache.t4g.micro"
    replica_count    = 0
    multi_az_enabled = false
  }

  expect_failures = [var.replica_count]
}

run "multi_az_requires_two_or_more_availability_zones" {
  command = plan

  variables {
    name_prefix        = "stellar-portfolio-staging"
    vpc_id             = "vpc-0123456789abcdef0"
    subnet_ids         = ["subnet-aaa"]
    node_type          = "cache.t4g.micro"
    multi_az_enabled   = true
    availability_zones = ["us-east-1a"]
  }

  expect_failures = [var.multi_az_enabled]
}

run "multi_az_requires_automatic_failover" {
  command = plan

  variables {
    name_prefix                = "stellar-portfolio-staging"
    vpc_id                     = "vpc-0123456789abcdef0"
    subnet_ids                 = ["subnet-aaa", "subnet-bbb"]
    node_type                  = "cache.t4g.micro"
    multi_az_enabled           = true
    automatic_failover_enabled = false
  }

  expect_failures = [var.multi_az_enabled]
}

run "replica_count_is_capped_at_five" {
  command = plan

  variables {
    name_prefix   = "stellar-portfolio-staging"
    vpc_id        = "vpc-0123456789abcdef0"
    subnet_ids    = ["subnet-aaa", "subnet-bbb"]
    node_type     = "cache.t4g.micro"
    replica_count = 6
  }

  expect_failures = [var.replica_count]
}

run "availability_zones_must_not_be_empty" {
  command = plan

  variables {
    name_prefix        = "stellar-portfolio-staging"
    vpc_id             = "vpc-0123456789abcdef0"
    subnet_ids         = ["subnet-aaa"]
    node_type          = "cache.t4g.micro"
    availability_zones = []
  }

  # An empty AZ list would break the modulo-based AZ placement in main.tf,
  # so the variable validation must reject it before plan evaluates locals.
  expect_failures = [var.availability_zones]
}

run "availability_zones_must_not_contain_duplicates" {
  command = plan

  variables {
    name_prefix        = "stellar-portfolio-staging"
    vpc_id             = "vpc-0123456789abcdef0"
    subnet_ids         = ["subnet-aaa", "subnet-bbb"]
    node_type          = "cache.t4g.micro"
    multi_az_enabled   = true
    availability_zones = ["us-east-1a", "us-east-1a"]
  }

  # Duplicates would place the "second" node back into the primary's AZ,
  # defeating Multi-AZ, so the variable-level duplicate check rejects the
  # list outright (the multi_az distinct-AZ validation short-circuits once
  # availability_zones itself is invalid).
  expect_failures = [var.availability_zones]
}
