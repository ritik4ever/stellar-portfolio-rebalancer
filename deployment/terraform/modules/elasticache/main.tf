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

resource "aws_security_group" "redis_rotation_lambda" {
  name        = "${var.name_prefix}-redis-rotation-lambda-sg"
  description = "Security group for Redis AUTH token rotation Lambda"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group_rule" "redis_from_rotation_lambda" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.redis_rotation_lambda.id
  security_group_id        = aws_security_group.redis.id
  description              = "Redis AUTH token rotation Lambda access"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name_prefix}-redis-subnet-group"
  subnet_ids = var.subnet_ids
}

resource "random_password" "redis_auth" {
  length  = 64
  special = false
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${var.name_prefix}-redis"
  description                = "Redis replication group for ${var.name_prefix}"
  engine                     = "redis"
  engine_version             = "7.0"
  node_type                  = var.node_type
  num_cache_clusters         = 1
  parameter_group_name       = "default.redis7"
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  transit_encryption_enabled = var.transit_encryption_enabled
  at_rest_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result
  auth_token_update_strategy = "SET"
  apply_immediately          = true

  lifecycle {
    ignore_changes = [auth_token]
  }

  tags = {
    Name = "${var.name_prefix}-redis"
  }
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name        = "${var.name_prefix}/redis/auth-token"
  description = "Redis AUTH token and endpoint for ${var.name_prefix}"
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id = aws_secretsmanager_secret.redis_auth.id
  secret_string = jsonencode({
    engine                     = "redis"
    replication_group_id       = aws_elasticache_replication_group.main.replication_group_id
    primary_endpoint_address   = aws_elasticache_replication_group.main.primary_endpoint_address
    port                       = aws_elasticache_replication_group.main.port
    auth_token                 = random_password.redis_auth.result
    tls                        = var.transit_encryption_enabled
    transit_encryption_enabled = var.transit_encryption_enabled
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

data "archive_file" "redis_auth_rotation" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  type        = "zip"
  source_file = "${path.module}/lambda/redis_auth_rotation.py"
  output_path = "${path.module}/redis_auth_rotation.zip"
}

resource "aws_iam_role" "redis_auth_rotation" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  name = "${var.name_prefix}-redis-auth-rotation"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "redis_auth_rotation_basic" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  role       = aws_iam_role.redis_auth_rotation[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "redis_auth_rotation_vpc" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  role       = aws_iam_role.redis_auth_rotation[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "redis_auth_rotation" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  name = "${var.name_prefix}-redis-auth-rotation"
  role = aws_iam_role.redis_auth_rotation[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage"
        ]
        Resource = aws_secretsmanager_secret.redis_auth.arn
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetRandomPassword",
          "elasticache:DescribeReplicationGroups",
          "elasticache:ModifyReplicationGroup"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "redis_auth_rotation" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  function_name    = "${var.name_prefix}-redis-auth-rotation"
  role             = aws_iam_role.redis_auth_rotation[0].arn
  handler          = "redis_auth_rotation.lambda_handler"
  runtime          = "python3.12"
  filename         = data.archive_file.redis_auth_rotation[0].output_path
  source_code_hash = data.archive_file.redis_auth_rotation[0].output_base64sha256
  timeout          = 300

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.redis_rotation_lambda.id]
  }

  environment {
    variables = {
      REPLICATION_GROUP_ID = aws_elasticache_replication_group.main.replication_group_id
      REDIS_HOST           = aws_elasticache_replication_group.main.primary_endpoint_address
      REDIS_PORT           = tostring(aws_elasticache_replication_group.main.port)
      REDIS_TLS            = tostring(var.transit_encryption_enabled)
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.redis_auth_rotation_basic,
    aws_iam_role_policy_attachment.redis_auth_rotation_vpc,
    aws_iam_role_policy.redis_auth_rotation,
  ]
}

resource "aws_lambda_permission" "allow_secretsmanager" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.redis_auth_rotation[0].function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = aws_secretsmanager_secret.redis_auth.arn
}

resource "aws_secretsmanager_secret_rotation" "redis_auth" {
  count = var.auth_token_rotation_days > 0 ? 1 : 0

  secret_id           = aws_secretsmanager_secret.redis_auth.id
  rotation_lambda_arn = aws_lambda_function.redis_auth_rotation[0].arn
  rotate_immediately  = var.rotate_auth_token_immediately

  rotation_rules {
    automatically_after_days = var.auth_token_rotation_days
  }

  depends_on = [aws_lambda_permission.allow_secretsmanager]
}
