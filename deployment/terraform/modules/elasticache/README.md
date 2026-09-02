# ElastiCache Redis module

Provisions the Redis replication group used by the backend (BullMQ queues,
rate limiting, distributed rebalance locks, idempotency store, cached price
feed).

The group runs with **Multi-AZ** and **automatic failover** enabled, with at
least one read replica pinned to a **different availability zone** from the
primary, so losing a node — or an entire AZ — does not take Redis down.

## What is provisioned

| Resource | Purpose |
| --- | --- |
| `aws_elasticache_replication_group.main` | Redis 7 replication group (`1` primary + `replica_count` read replicas) |
| `aws_elasticache_subnet_group.main` | Private subnets the nodes are placed in |
| `aws_security_group.redis` | Port `6379` ingress from the VPC CIDR |
| `aws_secretsmanager_secret.redis_auth` | Redis AUTH token (rotation is attached by the root module) |

### High-availability settings

```hcl
num_cache_clusters          = var.replica_count + 1     # 1 primary + N replicas
preferred_cache_cluster_azs = local.preferred_azs       # distinct AZ per node
automatic_failover_enabled  = true
multi_az_enabled            = true
```

* `num_cache_clusters` is `replica_count + 1` — one primary plus `replica_count`
  read replicas. `replica_count` defaults to `1` and is validated to be between
  `1` and `5` (the ElastiCache per-shard maximum).
* `preferred_cache_cluster_azs` is derived from `var.availability_zones`.
  ElastiCache allocates nodes in list order: **index 0 becomes the primary** and
  every entry after it becomes a read replica. The list is built by cycling
  through the AZ pool, so with `azs = ["us-east-1a", "us-east-1b"]` the primary
  lands in `us-east-1a` and the replica in `us-east-1b`.
* `multi_az_enabled = true` requires `automatic_failover_enabled = true` and
  `replica_count >= 1`; both are enforced by variable validation, so an invalid
  combination fails at `terraform plan` time rather than at apply time.

> **Note on node types:** Multi-AZ with automatic failover is not supported on
> T1/T2 node types. This module uses `cache.t4g.*` (staging `cache.t4g.micro`,
> production `cache.t4g.small`), which is supported.

## Failover behaviour

### What AWS does

1. ElastiCache detects that the primary node is unhealthy, or that the AZ
   hosting it is unavailable.
2. A read replica **in another AZ** is promoted to primary.
3. The **primary endpoint DNS record is repointed** at the promoted node. The
   reader endpoint is updated to load-balance across the remaining replicas.
4. A replacement replica is provisioned in a healthy AZ to restore the
   configured replica count.

Typical end-to-end duration is **a few seconds**; a full AZ event can take
**up to a couple of minutes**. Writes fail for the duration of the switchover —
this is the "brief failover interruption" the design accepts. Reads continue
to be served by the replicas throughout.

### What the application sees

Because the endpoint DNS name never changes, **no configuration change and no
redeployment is required**. Clients only need to reconnect.

During the switchover the current TCP connection is dropped and in-flight
commands fail with errors such as:

| Error | Meaning |
| --- | --- |
| `READONLY` | Command hit a replica that has not been promoted yet |
| `CLUSTERDOWN` / `MASTERDOWN` | Failover election in progress |
| `LOADING` | Promoted node is still loading its dataset |
| `ECONNRESET` / `ETIMEDOUT` | Socket to the old primary was dropped |

### Expected client reconnect handling

All backend clients are created through
`backend/src/config/redisConnectionOptions.ts`, which sets:

* **`retryStrategy`** — bounded exponential backoff, `200 ms` → `5 s` cap, and
  it **never returns `null`**, so the client keeps reconnecting for as long as
  the failover takes. Node re-resolves the endpoint DNS on every reconnect
  attempt, which is how the client picks up the promoted node.
* **`reconnectOnError`** —
  * returns `2` (reconnect **and replay** the command) for `READONLY`,
    `CLUSTERDOWN`, `MASTERDOWN`, `LOADING`, `TRY AGAIN` — the server provably
    did not execute the command;
  * returns `1` (reconnect **without** replaying) for socket-level failures
    (`ECONNRESET`, `ETIMEDOUT`, …) where the outcome is unknown;
  * returns `false` for errors reconnecting can never fix (auth, permissions),
    so credential problems still surface immediately.
* **`maxRetriesPerRequest: 20`** (BullMQ overrides this to `null`, which it
  requires) — commands issued during the switchover are queued and replayed
  rather than rejected, so callers observe latency instead of an error.
* **`connectTimeout: 10 s`** and **`commandTimeout: 15 s`**.
* **`autoResubscribe` / `autoResendUnfulfilledCommands`** — pub/sub state is
  rebuilt automatically after a reconnect.

Two clients are deliberately *not* long-retrying:

* `redisProbe` (`getRedisProbeOptions`) — startup reachability checks must stay
  fast, so it fails immediately.
* `reflector.ts` price-feed cache — fail-fast is intentional; a Redis miss
  falls back to the HTTP oracle.

### Endpoint configuration (backend environment)

Terraform injects the endpoints into the ECS task definition:

| Variable | Value | Notes |
| --- | --- | --- |
| `REDIS_HOST` | `module.elasticache.redis_primary_endpoint` | **Replication-group** primary endpoint (`host:port`). Never a single node address. |
| `REDIS_READER_HOST` | `module.elasticache.redis_reader_endpoint` | Read-only endpoint, load-balanced across replicas. |
| `REDIS_TLS` | `module.elasticache.transit_encryption_enabled` | `true` → backend connects with `rediss://`. |
| `REDIS_AUTH_TOKEN` | Secrets Manager `auth_token` | Injected as a task secret. |

Resolution order in `credentialManager` is `REDIS_URL` → `REDIS_HOST` →
`redis://localhost:6379`, so local development and docker-compose are
unaffected.

## Inputs

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `name_prefix` | `string` | — | Prefix for all resource names |
| `vpc_id` | `string` | — | VPC for the Redis security group |
| `subnet_ids` | `list(string)` | — | Subnets for the cache subnet group (one per AZ in `availability_zones`) |
| `node_type` | `string` | — | ElastiCache node type, e.g. `cache.t4g.small` |
| `replica_count` | `number` | `1` | Read replicas; `1`–`5`, at least `1` for failover |
| `availability_zones` | `list(string)` | `["us-east-1a", "us-east-1b"]` | AZ pool the nodes are spread across |
| `multi_az_enabled` | `bool` | `true` | Multi-AZ with automatic failover |
| `automatic_failover_enabled` | `bool` | `true` | Promote a replica when the primary fails |
| `transit_encryption_enabled` | `bool` | `true` | TLS; clients must use `rediss://` |
| `at_rest_encryption_enabled` | `bool` | `true` | Encrypt data at rest |
| `auth_token_enabled` | `bool` | `true` | Generate and require a Redis AUTH token |
| `apply_immediately` | `bool` | `true` | Apply changes outside the maintenance window |

## Outputs

| Name | Description |
| --- | --- |
| `redis_endpoint` / `redis_primary_endpoint` | Primary endpoint as `host:port` |
| `redis_reader_endpoint` | Reader endpoint as `host:port` |
| `redis_primary_endpoint_address` / `redis_reader_endpoint_address` | Endpoint hostnames |
| `redis_port` | Listening port |
| `multi_az_enabled` / `automatic_failover_enabled` | Effective HA settings |
| `num_cache_clusters` / `node_count` | Node count |
| `preferred_cache_cluster_azs` | AZ pinned to each node, in allocation order |
| `redis_replication_group_id` | Replication group ID (used by the rotation Lambda) |
| `redis_secret_arn` / `redis_auth_token` | AUTH token secret |
| `transit_encryption_enabled` | Whether TLS is required |

## Tests

Terraform native tests (mocked AWS provider, fully offline):

```bash
cd deployment/terraform/modules/elasticache
terraform init -backend=false
terraform test
```

They assert that Multi-AZ and automatic failover are on by default, that the
read replica lands in a different AZ from the primary, that the AZ pool cycles
when there are more replicas than AZs, and that invalid combinations are
rejected at plan time.

## Verifying a failover (optional drill)

```bash
REPL_ID=$(terraform output -raw redis_replication_group_id)

# Force a failover to a replica in another AZ
aws elasticache test-failover \
  --replication-group-id "$REPL_ID" \
  --node-group-id 0001

# Watch until the group reports "available" again
aws elasticache describe-replication-groups \
  --replication-group-id "$REPL_ID" \
  --query 'ReplicationGroups[0].Status'
```

While the drill runs, expect a short burst of `READONLY` / `CLUSTERDOWN` log
lines from the backend and then automatic recovery — with no restart and no
configuration change.
