# Rollout input validation tests. These use mocked providers and fail during
# planning, before any infrastructure operation can be applied.

mock_provider "aws" {}
mock_provider "random" {}

run "rejects_invalid_network_and_naming_inputs" {
  command = plan

  variables {
    aws_region  = ""
    project_name = "invalid project name"
    vpc_cidr    = "not-a-cidr"
  }

  expect_failures = [
    var.aws_region,
    var.project_name,
    var.vpc_cidr,
  ]
}

run "rejects_duplicate_availability_zones" {
  command = plan

  variables {
    azs = ["us-east-1a", "us-east-1a"]
  }

  expect_failures = [var.azs]
}

run "rejects_unsafe_blue_green_rollback_settings" {
  command = plan

  variables {
    blue_green_deployment_config = {
      termination_wait_time_in_minutes = 0
      deployment_ready_option = {
        action_on_timeout = "UNSAFE_VALUE"
      }
    }
  }

  expect_failures = [var.blue_green_deployment_config]
}

run "rejects_zero_task_capacity" {
  command = plan

  variables {
    ecs_min_capacity = {
      staging    = 0
      production = 2
    }
    ecs_max_capacity = {
      staging    = 3
      production = 10
    }
  }

  expect_failures = [var.ecs_min_capacity]
}

run "rejects_inverted_task_capacity_range" {
  command = plan

  variables {
    ecs_min_capacity = {
      staging    = 4
      production = 2
    }
    ecs_max_capacity = {
      staging    = 2
      production = 10
    }
  }

  expect_failures = [module.ecs.aws_appautoscaling_target.ecs_target]
}
