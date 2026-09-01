resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-ecs-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Security group for ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Test listener port used by CodeDeploy for blue/green health-check traffic
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${var.name_prefix}-ecs-tasks-sg"
  description = "Allow inbound access from the ALB only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "main" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
}

# Blue target group – receives production traffic by default
resource "aws_lb_target_group" "main" {
  name        = "${var.name_prefix}-tg-blue"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    healthy_threshold   = 3
    interval            = 30
    protocol            = "HTTP"
    matcher             = "200"
    timeout             = 3
    path                = "/api/v1/health"
    unhealthy_threshold = 2
  }
}

# Green target group – used by CodeDeploy to stage the new version
resource "aws_lb_target_group" "green" {
  count       = var.enable_blue_green ? 1 : 0
  name        = "${var.name_prefix}-tg-green"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    healthy_threshold   = 3
    interval            = 30
    protocol            = "HTTP"
    matcher             = "200"
    timeout             = 3
    path                = "/api/v1/health"
    unhealthy_threshold = 2
  }
}

# Production listener on port 80 – CodeDeploy shifts traffic here
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}

# Test listener on port 8080 – CodeDeploy routes test/canary traffic here
# before committing to the full traffic shift on the production listener.
resource "aws_lb_listener" "test" {
  count             = var.enable_blue_green ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = "8080"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.green[0].arn
  }
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${var.name_prefix}-ecsTaskExecutionRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_policy" "ecs_secrets_policy" {
  name        = "${var.name_prefix}-ecsSecretsPolicy"
  description = "Allows ECS tasks to read secrets from AWS Secrets Manager"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "kms:Decrypt"
        ]
        Resource = [
          var.db_secret_arn,
          var.redis_secret_arn,
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_secrets_policy_attach" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.ecs_secrets_policy.arn
}

resource "aws_ecs_task_definition" "main" {
  family                   = "${var.name_prefix}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([
    {
      name  = "backend"
      image = "ghcr.io/ritik4ever/stellar-portfolio-rebalancer-backend:latest"
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "PORT"
          value = "3000"
        },
        {
          name  = "DB_HOST"
          value = var.db_host
        },
        {
          name  = "REDIS_HOST"
          value = var.redis_host
        },
        {
          name  = "DB_SECRET_ARN"
          value = var.db_secret_arn
        },
        {
          name  = "REDIS_SECRET_ARN"
          value = var.redis_secret_arn
        }
      ]
      secrets = [
        {
          name      = "DB_PASSWORD"
          valueFrom = "${var.db_secret_arn}:password::"
        },
        {
          name      = "DB_USER"
          valueFrom = "${var.db_secret_arn}:username::"
        },
        {
          name      = "REDIS_AUTH_TOKEN"
          valueFrom = "${var.redis_secret_arn}:auth_token::"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.name_prefix}-backend"
          "awslogs-region"        = "us-east-1"
          "awslogs-stream-prefix" = "ecs"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "main" {
  name            = "${var.name_prefix}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    security_groups  = [aws_security_group.ecs_tasks.id]
    subnets          = var.private_subnet_ids
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.main.arn
    container_name   = "backend"
    container_port   = 3000
  }

  # When blue/green is enabled CodeDeploy manages traffic shifting;
  # rolling updates are used otherwise.
  deployment_controller {
    type = var.enable_blue_green ? "CODE_DEPLOY" : "ECS"
  }

  depends_on = [aws_lb_listener.http]

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    # CodeDeploy owns task_definition and load_balancer changes during deployments
    ignore_changes = [
      desired_count,
      task_definition,
      load_balancer,
    ]
  }
}

resource "aws_appautoscaling_target" "ecs_target" {
  max_capacity       = var.ecs_max_capacity
  min_capacity       = var.ecs_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.main.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "scale_out" {
  name               = "${var.name_prefix}-scale-out"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.ecs_target.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_target.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }
  }
}

resource "aws_appautoscaling_policy" "scale_in" {
  name               = "${var.name_prefix}-scale-in"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.ecs_target.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_target.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 300
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "high_queue_backlog" {
  alarm_name          = "${var.name_prefix}-high-queue-backlog"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "QueueBacklogDepth"
  namespace           = "StellarPortfolio"
  period              = 60
  statistic           = "Average"
  threshold           = var.queue_backlog_high_threshold
  alarm_description   = "Scale out if queue backlog depth is high"
  alarm_actions       = [aws_appautoscaling_policy.scale_out.arn]
}

resource "aws_cloudwatch_metric_alarm" "low_queue_backlog" {
  alarm_name          = "${var.name_prefix}-low-queue-backlog"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "QueueBacklogDepth"
  namespace           = "StellarPortfolio"
  period              = 60
  statistic           = "Average"
  threshold           = var.queue_backlog_low_threshold
  alarm_description   = "Scale in if queue backlog depth is low"
  alarm_actions       = [aws_appautoscaling_policy.scale_in.arn]
}

# ---------------------------------------------------------------------------
# Blue/Green deployment resources (created only when enable_blue_green = true)
# ---------------------------------------------------------------------------

# IAM role for CodeDeploy
resource "aws_iam_role" "codedeploy" {
  count = var.enable_blue_green ? 1 : 0
  name  = "${var.name_prefix}-codedeploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "codedeploy.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "codedeploy_policy" {
  count      = var.enable_blue_green ? 1 : 0
  role       = aws_iam_role.codedeploy[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRoleForECS"
}

# SNS topic for deployment notifications
resource "aws_sns_topic" "deployment_notifications" {
  count = var.enable_blue_green ? 1 : 0
  name  = "${var.name_prefix}-deployment-notifications"

  tags = {
    Project     = "StellarPortfolioRebalancer"
    Environment = var.name_prefix
    ManagedBy   = "Terraform"
  }
}

resource "aws_sns_topic_policy" "deployment_notifications" {
  count = var.enable_blue_green ? 1 : 0
  arn   = aws_sns_topic.deployment_notifications[0].arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "codedeploy.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.deployment_notifications[0].arn
      }
    ]
  })
}

# CloudWatch alarm that triggers automatic rollback when healthy hosts drop
# below 1 during a deployment. CodeDeploy references this alarm by name.
resource "aws_cloudwatch_metric_alarm" "deployment_health" {
  count               = var.enable_blue_green ? 1 : 0
  alarm_name          = "${var.name_prefix}-deployment-alarm"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "Alarm when healthy hosts drop below threshold during deployment"
  alarm_actions       = [aws_sns_topic.deployment_notifications[0].arn]

  dimensions = {
    TargetGroup  = aws_lb_target_group.main.arn_suffix
    LoadBalancer = aws_lb.main.arn_suffix
  }
}

# CodeDeploy application – compute_platform must be "ECS" for blue/green ECS
resource "aws_codedeploy_app" "main" {
  count            = var.enable_blue_green ? 1 : 0
  name             = "${var.name_prefix}-ecs-app"
  compute_platform = "ECS"
}

# CodeDeploy deployment configuration – controls how traffic shifts between
# the blue and green target groups.
# CodeDeployDefault.ECSAllAtOnce shifts 100 % after health checks pass.
# Use CodeDeployDefault.ECSCanary10Percent5Minutes or a custom config for
# gradual canary-style shifts.
resource "aws_codedeploy_deployment_config" "main" {
  count                      = var.enable_blue_green ? 1 : 0
  deployment_config_name     = "${var.name_prefix}-ecs-deployment-config"
  compute_platform           = "ECS"

  traffic_routing_config {
    type = "AllAtOnce"
  }
}

# CodeDeploy deployment group – ties the app, ECS service, ALB listeners,
# target groups, rollback rules, and CloudWatch alarms together.
resource "aws_codedeploy_deployment_group" "main" {
  count                  = var.enable_blue_green ? 1 : 0
  app_name               = aws_codedeploy_app.main[0].name
  deployment_group_name  = "${var.name_prefix}-deployment-group"
  service_role_arn       = aws_iam_role.codedeploy[0].arn
  deployment_config_name = aws_codedeploy_deployment_config.main[0].deployment_config_name

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  blue_green_deployment_config {
    # How long to wait before shifting traffic once health checks pass.
    # CONTINUE_DEPLOYMENT means proceed immediately.
    deployment_ready_option {
      action_on_timeout = var.blue_green_deployment_config.deployment_ready_option.action_on_timeout
    }

    # Keep the original (blue) task set running for this many minutes after a
    # successful shift so a manual or automatic rollback can redirect traffic
    # back instantly without a cold start.
    terminate_blue_instances_on_deployment_success {
      action                           = "TERMINATE"
      termination_wait_time_in_minutes = var.blue_green_deployment_config.termination_wait_time_in_minutes
    }
  }

  load_balancer_info {
    target_group_pair_info {
      # Production listener – receives live user traffic
      prod_traffic_route {
        listener_arns = [aws_lb_listener.http.arn]
      }

      # Test listener – CodeDeploy routes health-check traffic here before
      # switching the production listener
      test_traffic_route {
        listener_arns = [aws_lb_listener.test[0].arn]
      }

      # Blue target group (current / original)
      target_group {
        name = aws_lb_target_group.main.name
      }

      # Green target group (new version)
      target_group {
        name = aws_lb_target_group.green[0].name
      }
    }
  }

  ecs_service {
    cluster_name = aws_ecs_cluster.main.name
    service_name = aws_ecs_service.main.name
  }

  # Automatically roll back on deployment failure or when the CloudWatch
  # health alarm fires during the traffic shift.
  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  }

  # Wire in the CloudWatch alarm so CodeDeploy watches healthy host count
  # and triggers an automatic rollback if it fires.
  alarm_configuration {
    alarms                    = [aws_cloudwatch_metric_alarm.deployment_health[0].alarm_name]
    enabled                   = true
    ignore_poll_alarm_failure = false
  }

  trigger_configuration {
    trigger_events     = ["DeploymentSuccess", "DeploymentFailure", "DeploymentRollback"]
    trigger_name       = "${var.name_prefix}-deployment-events"
    trigger_target_arn = aws_sns_topic.deployment_notifications[0].arn
  }
}
