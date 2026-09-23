# Terraform native tests for the RDS snapshot retention feature (Issue #1277).
# Provider calls are mocked, so this runs fully offline: `terraform test`.
# Verified behaviors: retention wiring, cleanup automation, IAM scope, tagging,
# and that changing retention propagates to the Lambda environment.

mock_provider "aws" {}

run "rds_instance_uses_configured_retention" {
  command = plan

  assert {
    condition     = aws_db_instance.main.backup_retention_period == 7
    error_message = "RDS instance must use the configured backup_retention_period (default 7)."
  }

  assert {
    condition     = aws_db_instance.main.backup_window == "03:00-04:00"
    error_message = "RDS instance must use the configured backup_window."
  }

  assert {
    condition     = aws_db_instance.main.copy_tags_to_snapshot == true
    error_message = "Snapshots must inherit instance tags (copy_tags_to_snapshot)."
  }

  assert {
    condition     = aws_db_instance.main.skip_final_snapshot == false
    error_message = "Final snapshot must be kept (skip_final_snapshot = false)."
  }
}

run "cleanup_automation_is_provisioned" {
  command = plan

  assert {
    condition     = aws_lambda_function.snapshot_retention.function_name == "${var.name_prefix}-rds-snapshot-retention"
    error_message = "Snapshot retention Lambda must be provisioned by Terraform."
  }

  assert {
    condition     = strcontains(aws_cloudwatch_event_rule.snapshot_retention.schedule_expression, "cron(")
    error_message = "Cleanup must be scheduled via an EventBridge cron rule."
  }

  assert {
    condition     = aws_lambda_permission.snapshot_retention.source_arn == aws_cloudwatch_event_rule.snapshot_retention.arn
    error_message = "EventBridge rule must be allowed to invoke the cleanup Lambda."
  }

  assert {
    condition     = aws_cloudwatch_event_target.snapshot_retention.arn == aws_lambda_function.snapshot_retention.arn
    error_message = "EventBridge target must point at the cleanup Lambda."
  }
}

run "retention_flows_into_lambda_environment" {
  command = plan

  variables {
    backup_retention_period = 14
  }

  assert {
    condition     = aws_lambda_function.snapshot_retention.environment[0].variables.RETENTION_DAYS == "14"
    error_message = "Changing backup_retention_period must propagate to the cleanup Lambda environment."
  }

  assert {
    condition     = aws_lambda_function.snapshot_retention.environment[0].variables.SNAPSHOT_OWNER == var.name_prefix
    error_message = "Cleanup Lambda must be scoped to this environment's name_prefix."
  }

  assert {
    condition     = aws_lambda_function.snapshot_retention.environment[0].variables.FINAL_SNAPSHOT == "${var.name_prefix}-db-final"
    error_message = "Cleanup Lambda must ignore the instance final snapshot."
  }
}

run "retention_variable_validation_rejects_out_of_range" {
  command = plan

  variables {
    backup_retention_period = 40
  }

  expect_failures = [var.backup_retention_period]
}

run "iam_permissions_are_present_and_scoped" {
  command = plan

  assert {
    condition     = aws_iam_role_policy.snapshot_retention.policy != null
    error_message = "Cleanup Lambda must have an inline IAM policy."
  }

  assert {
    condition     = contains(jsondecode(aws_iam_role_policy.snapshot_retention.policy).Statement[1].Action, "rds:DeleteDBSnapshot")
    error_message = "IAM policy must allow deleting snapshots."
  }

  assert {
    condition     = !contains(jsondecode(aws_iam_role_policy.snapshot_retention.policy).Statement[1].Action, "rds:CreateDBSnapshot")
    error_message = "Cleanup Lambda must not create snapshots (delete-only lifecycle)."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.snapshot_retention.policy).Statement[0].Resource == "${aws_cloudwatch_log_group.snapshot_retention.arn}:*"
    error_message = "Log permissions must be scoped to this Lambda's own log group."
  }
}

run "cleanup_schedule_is_configurable" {
  command = plan

  variables {
    snapshot_cleanup_schedule = "cron(0 6 * * ? *)"
  }

  assert {
    condition     = aws_cloudwatch_event_rule.snapshot_retention.schedule_expression == "cron(0 6 * * ? *)"
    error_message = "Cleanup schedule must be configurable via snapshot_cleanup_schedule."
  }
}
