import json
import os
import secrets
import socket
import ssl
import time

import boto3
from botocore.exceptions import ClientError

secretsmanager = boto3.client("secretsmanager")
elasticache = boto3.client("elasticache")

EXCLUDED_AUTH_CHARS = '/"@\\'


def lambda_handler(event, _context):
    arn = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    metadata = secretsmanager.describe_secret(SecretId=arn)
    if not metadata.get("RotationEnabled"):
        raise ValueError(f"Secret {arn} is not enabled for rotation")

    versions = metadata.get("VersionIdsToStages", {})
    if token not in versions:
        raise ValueError(f"Secret version {token} has no stage for {arn}")
    if "AWSCURRENT" in versions[token]:
        return
    if "AWSPENDING" not in versions[token]:
        raise ValueError(f"Secret version {token} is not set as AWSPENDING for {arn}")

    if step == "createSecret":
        create_secret(arn, token)
    elif step == "setSecret":
        set_secret(arn, token)
    elif step == "testSecret":
        test_secret(arn, token)
    elif step == "finishSecret":
        finish_secret(arn, token, metadata)
    else:
        raise ValueError(f"Invalid rotation step: {step}")


def get_secret_dict(secret_id, version_stage):
    response = secretsmanager.get_secret_value(SecretId=secret_id, VersionStage=version_stage)
    return json.loads(response["SecretString"])


def create_secret(secret_id, token):
    try:
        secretsmanager.get_secret_value(
            SecretId=secret_id,
            VersionId=token,
            VersionStage="AWSPENDING",
        )
        return
    except ClientError as exc:
        if exc.response["Error"]["Code"] not in ("ResourceNotFoundException", "InvalidRequestException"):
            raise

    current = get_secret_dict(secret_id, "AWSCURRENT")
    pending = dict(current)
    pending["auth_token"] = generate_auth_token()

    secretsmanager.put_secret_value(
        SecretId=secret_id,
        ClientRequestToken=token,
        SecretString=json.dumps(pending, separators=(",", ":")),
        VersionStages=["AWSPENDING"],
    )


def generate_auth_token():
    try:
        response = secretsmanager.get_random_password(
            PasswordLength=64,
            ExcludeCharacters=EXCLUDED_AUTH_CHARS,
            ExcludePunctuation=True,
        )
        return response["RandomPassword"]
    except Exception:
        alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return "".join(secrets.choice(alphabet) for _ in range(64))


def set_secret(secret_id, token):
    pending = get_secret_dict(secret_id, "AWSPENDING")
    auth_token = pending["auth_token"]
    replication_group_id = pending.get("replication_group_id") or os.environ["REPLICATION_GROUP_ID"]

    elasticache.modify_replication_group(
        ReplicationGroupId=replication_group_id,
        AuthToken=auth_token,
        AuthTokenUpdateStrategy="ROTATE",
        ApplyImmediately=True,
    )
    wait_for_replication_group_available(replication_group_id)


def wait_for_replication_group_available(replication_group_id):
    deadline = time.time() + 240
    while time.time() < deadline:
        response = elasticache.describe_replication_groups(ReplicationGroupId=replication_group_id)
        group = response["ReplicationGroups"][0]
        if group.get("Status") == "available":
            return
        time.sleep(10)
    raise TimeoutError(f"Timed out waiting for Redis replication group {replication_group_id} to become available")


def test_secret(secret_id, token):
    pending = get_secret_dict(secret_id, "AWSPENDING")
    host = pending.get("primary_endpoint_address") or pending.get("host") or os.environ["REDIS_HOST"]
    port = int(pending.get("port") or os.environ.get("REDIS_PORT", "6379"))
    use_tls = str(pending.get("tls", os.environ.get("REDIS_TLS", "true"))).lower() in ("1", "true", "yes")

    with socket.create_connection((host, port), timeout=10) as raw_sock:
        if use_tls:
            context = ssl.create_default_context()
            with context.wrap_socket(raw_sock, server_hostname=host) as tls_sock:
                authenticate_and_ping(tls_sock, pending["auth_token"])
        else:
            authenticate_and_ping(raw_sock, pending["auth_token"])


def authenticate_and_ping(sock, auth_token):
    send_resp(sock, ["AUTH", auth_token])
    read_resp_ok(sock, allow_pong=False)
    send_resp(sock, ["PING"])
    read_resp_ok(sock, allow_pong=True)


def send_resp(sock, parts):
    payload = f"*{len(parts)}\r\n".encode("utf-8")
    for part in parts:
        encoded = str(part).encode("utf-8")
        payload += f"${len(encoded)}\r\n".encode("utf-8") + encoded + b"\r\n"
    sock.sendall(payload)


def read_line(sock):
    data = bytearray()
    while not data.endswith(b"\r\n"):
        chunk = sock.recv(1)
        if not chunk:
            raise ConnectionError("Redis closed connection")
        data.extend(chunk)
    return bytes(data[:-2]).decode("utf-8", errors="replace")


def read_resp_ok(sock, allow_pong):
    line = read_line(sock)
    if line.startswith("-NOAUTH") or line.startswith("-WRONGPASS") or line.startswith("-ERR"):
        raise PermissionError(f"Redis rejected rotated AUTH token: {line}")
    expected = {"+OK"}
    if allow_pong:
        expected.add("+PONG")
    if line not in expected:
        raise RuntimeError(f"Unexpected Redis response during token rotation test: {line}")


def finish_secret(secret_id, token, metadata):
    current_version = None
    for version, stages in metadata.get("VersionIdsToStages", {}).items():
        if "AWSCURRENT" in stages:
            current_version = version
            break

    if current_version == token:
        return

    kwargs = {
        "SecretId": secret_id,
        "VersionStage": "AWSCURRENT",
        "MoveToVersionId": token,
    }
    if current_version:
        kwargs["RemoveFromVersionId"] = current_version
    secretsmanager.update_secret_version_stage(**kwargs)
