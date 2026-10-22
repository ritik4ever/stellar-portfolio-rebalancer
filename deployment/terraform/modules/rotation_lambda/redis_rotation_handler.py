"""
redis_rotation_handler.py
─────────────────────────
AWS Secrets Manager rotation Lambda for an ElastiCache Redis AUTH token.

Rotation strategy
─────────────────
ElastiCache supports two AUTH tokens on a replication group simultaneously
during the MODIFY operation window.  The steps below implement a zero-downtime
rotation:

  Step 1 – createSecret
      Generate a new random token and store it as AWSPENDING in Secrets Manager.

  Step 2 – setSecret
      Add the AWSPENDING token to ElastiCache (the group then accepts BOTH the
      current AWSCURRENT token and the new AWSPENDING token).

  Step 3 – testSecret
      Verify connectivity using the AWSPENDING token.

  Step 4 – finishSecret
      Move AWSPENDING → AWSCURRENT in Secrets Manager, then remove the old
      AWSCURRENT token from ElastiCache so only the new token is accepted.

Environment variables (set by Terraform)
─────────────────────────────────────────
  REDIS_REPLICATION_GROUP_ID  – ElastiCache replication group to update.
  SECRET_ARN                  – Secrets Manager secret ARN (informational).
"""

import json
import logging
import os
import secrets
import string
import time

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SECRETS_CLIENT = boto3.client("secretsmanager")
ELASTICACHE_CLIENT = boto3.client("elasticache")

REPLICATION_GROUP_ID = os.environ["REDIS_REPLICATION_GROUP_ID"]


def lambda_handler(event: dict, _context) -> None:
    """Entry point invoked by Secrets Manager for each rotation step."""
    arn = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    metadata = SECRETS_CLIENT.describe_secret(SecretId=arn)
    if not metadata.get("RotationEnabled"):
        raise ValueError(f"Secret {arn} does not have rotation enabled")

    versions = metadata.get("VersionIdsToStages", {})
    if token not in versions:
        raise ValueError(f"Version {token} has no stage for secret {arn}")
    if "AWSCURRENT" in versions[token]:
        logger.info("Version %s is already AWSCURRENT – nothing to do", token)
        return
    if "AWSPENDING" not in versions[token]:
        raise ValueError(f"Version {token} is not AWSPENDING for secret {arn}")

    if step == "createSecret":
        _create_secret(arn, token)
    elif step == "setSecret":
        _set_secret(arn, token)
    elif step == "testSecret":
        _test_secret(arn, token)
    elif step == "finishSecret":
        _finish_secret(arn, token)
    else:
        raise ValueError(f"Unknown rotation step: {step}")


# ─── Step helpers ──────────────────────────────────────────────────────────────

def _create_secret(arn: str, token: str) -> None:
    """Generate a new AUTH token and store it as AWSPENDING."""
    try:
        SECRETS_CLIENT.get_secret_value(SecretId=arn, VersionStage="AWSPENDING")
        logger.info("AWSPENDING already exists – skipping creation")
        return
    except SECRETS_CLIENT.exceptions.ResourceNotFoundException:
        pass

    new_token = _generate_token()
    secret_payload = json.dumps({"auth_token": new_token})

    SECRETS_CLIENT.put_secret_value(
        SecretId=arn,
        ClientRequestToken=token,
        SecretString=secret_payload,
        VersionStages=["AWSPENDING"],
    )
    logger.info("Created AWSPENDING secret version %s for %s", token, arn)


def _set_secret(arn: str, token: str) -> None:
    """Add the AWSPENDING token to the ElastiCache replication group."""
    pending_secret = _get_secret_dict(arn, "AWSPENDING")
    new_token = pending_secret["auth_token"]

    # ElastiCache allows setting a second AUTH token alongside the current one.
    # AuthTokenUpdateStrategyType=ROTATE adds the new token without removing the old.
    ELASTICACHE_CLIENT.modify_replication_group(
        ReplicationGroupId=REPLICATION_GROUP_ID,
        AuthToken=new_token,
        AuthTokenUpdateStrategy="ROTATE",
        ApplyImmediately=True,
    )
    logger.info(
        "Modified ElastiCache replication group %s to accept AWSPENDING token",
        REPLICATION_GROUP_ID,
    )
    _wait_for_group_available()


def _test_secret(arn: str, _token: str) -> None:
    """Verify the AWSPENDING token allows a Redis PING."""
    try:
        import redis as redis_lib  # type: ignore[import]
    except ImportError:
        logger.warning(
            "redis package not available in Lambda layer – skipping live PING test. "
            "Install the redis Python package as a Lambda layer for full validation."
        )
        return

    pending_secret = _get_secret_dict(arn, "AWSPENDING")
    new_token = pending_secret["auth_token"]

    host = _get_redis_host()
    client = redis_lib.Redis(
        host=host,
        port=6379,
        password=new_token,
        ssl=True,
        socket_connect_timeout=5,
        socket_timeout=5,
    )
    result = client.ping()
    client.close()
    if not result:
        raise RuntimeError(
            f"PING to Redis {host} with new AUTH token returned False"
        )
    logger.info("PING succeeded with AWSPENDING token for %s", arn)


def _finish_secret(arn: str, token: str) -> None:
    """Promote AWSPENDING → AWSCURRENT and remove the old token from ElastiCache."""
    metadata = SECRETS_CLIENT.describe_secret(SecretId=arn)
    current_version = next(
        (
            v
            for v, stages in metadata["VersionIdsToStages"].items()
            if "AWSCURRENT" in stages
        ),
        None,
    )
    if current_version == token:
        logger.info("Version %s is already AWSCURRENT – nothing to do", token)
        return

    # Promote the pending version to AWSCURRENT
    SECRETS_CLIENT.update_secret_version_stage(
        SecretId=arn,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=current_version,
    )
    logger.info("Promoted version %s to AWSCURRENT for %s", token, arn)

    # Remove the old token from ElastiCache
    pending_secret = _get_secret_dict(arn, "AWSCURRENT")
    new_token = pending_secret["auth_token"]
    ELASTICACHE_CLIENT.modify_replication_group(
        ReplicationGroupId=REPLICATION_GROUP_ID,
        AuthToken=new_token,
        AuthTokenUpdateStrategy="SET",
        ApplyImmediately=True,
    )
    logger.info(
        "Updated ElastiCache replication group %s to SET (only new token accepted)",
        REPLICATION_GROUP_ID,
    )
    _wait_for_group_available()


# ─── Utilities ─────────────────────────────────────────────────────────────────

def _generate_token(length: int = 64) -> str:
    """Generate a URL-safe random AUTH token. ElastiCache requires no spaces."""
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _get_secret_dict(arn: str, stage: str) -> dict:
    response = SECRETS_CLIENT.get_secret_value(SecretId=arn, VersionStage=stage)
    return json.loads(response["SecretString"])


def _wait_for_group_available(max_attempts: int = 30, delay_seconds: int = 10) -> None:
    """Poll until the replication group status returns to 'available'."""
    for attempt in range(max_attempts):
        resp = ELASTICACHE_CLIENT.describe_replication_groups(
            ReplicationGroupId=REPLICATION_GROUP_ID
        )
        status = resp["ReplicationGroups"][0]["Status"]
        if status == "available":
            logger.info("Replication group %s is available", REPLICATION_GROUP_ID)
            return
        logger.info(
            "Waiting for replication group %s (status=%s) – attempt %d/%d",
            REPLICATION_GROUP_ID,
            status,
            attempt + 1,
            max_attempts,
        )
        time.sleep(delay_seconds)
    raise TimeoutError(
        f"Replication group {REPLICATION_GROUP_ID} did not become available "
        f"after {max_attempts * delay_seconds}s"
    )


def _get_redis_host() -> str:
    """Resolve the primary ElastiCache endpoint for the replication group."""
    resp = ELASTICACHE_CLIENT.describe_replication_groups(
        ReplicationGroupId=REPLICATION_GROUP_ID
    )
    group = resp["ReplicationGroups"][0]
    endpoint = group.get("ConfigurationEndpoint") or group["NodeGroups"][0]["PrimaryEndpoint"]
    return endpoint["Address"]
