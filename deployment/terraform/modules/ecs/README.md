# ECS Module

This module sets up an Amazon ECS (Fargate) service for the application, including the cluster, task definitions, IAM roles, security groups, and an Application Load Balancer.

## Autoscaling

The ECS service is configured to automatically scale in and out based on a custom CloudWatch metric (`QueueBacklogDepth` in the `StellarPortfolio` namespace). 

### Scaling Thresholds

- **Scale Out**: When the `QueueBacklogDepth` metric is greater than or equal to `queue_backlog_high_threshold` (default: 100) for 1 period of 60 seconds, a step scaling policy adds 1 task.
- **Scale In**: When the `QueueBacklogDepth` metric is less than `queue_backlog_low_threshold` (default: 10) for 3 consecutive periods of 60 seconds, a step scaling policy removes 1 task.

### Capacity

- **Minimum Tasks**: Controlled by `ecs_min_capacity` (default: 1).
- **Maximum Tasks**: Controlled by `ecs_max_capacity` (default: 5).

## Inputs

| Name | Description | Type | Default |
|------|-------------|------|---------|
| `name_prefix` | Resource name prefix | `string` | n/a |
| `vpc_id` | VPC ID | `string` | n/a |
| `public_subnet_ids` | Public subnets for ALB | `list(string)` | n/a |
| `private_subnet_ids` | Private subnets for ECS tasks | `list(string)` | n/a |
| `task_cpu` | CPU for ECS task | `number` | n/a |
| `task_memory` | Memory for ECS task | `number` | n/a |
| `db_secret_arn` | ARN for Database Secret | `string` | n/a |
| `db_host` | Database Hostname | `string` | n/a |
| `redis_host` | Redis Hostname | `string` | n/a |
| `ecs_min_capacity` | Minimum number of tasks | `number` | `1` |
| `ecs_max_capacity` | Maximum number of tasks | `number` | `5` |
| `queue_backlog_high_threshold` | Backlog depth scale-out trigger | `number` | `100` |
| `queue_backlog_low_threshold` | Backlog depth scale-in trigger | `number` | `10` |
