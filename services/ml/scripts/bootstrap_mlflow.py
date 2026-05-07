"""
Bootstrap MLflow tracking + artifact store for SharkPark.

Run ONCE per environment (local dev, CI, prod) after setting the MLflow env
vars in ``.env`` / GitHub Actions secrets / Fly secrets:

    uv run python -m scripts.bootstrap_mlflow

What it does (idempotent — safe to re-run):

1. Calls ``configure_mlflow()`` (mirrors R2_* → AWS_*, sets tracking URI,
   redacts credentials in logs).
2. Validates the tracking URI by hitting the MLflow REST API
   (``MlflowClient.search_experiments(max_results=1)``).
3. Validates R2 credentials by issuing a no-op ``HeadBucket`` against the
   configured artifact bucket.
4. Ensures both production experiments exist with the correct
   ``artifact_location`` (immutable post-create — see
   ``ensure_experiment`` for the warning when a mismatch is detected):

   - ``sharkpark-short-term``
   - ``sharkpark-long-term``

5. Prints a status table.

Exits non-zero on the first failure so it can gate CI / Fly deploys.
"""

from __future__ import annotations

import logging
import os
import sys
from uuid import uuid4
from urllib.parse import urlparse

import boto3
import mlflow
from botocore.exceptions import BotoCoreError, ClientError
from mlflow.tracking import MlflowClient

from src.utils.mlflow_setup import configure_mlflow, ensure_experiment

logger = logging.getLogger(__name__)

PRODUCTION_EXPERIMENTS = ("sharkpark-short-term", "sharkpark-long-term")


def _check_tracking_uri() -> str:
    uri = mlflow.get_tracking_uri()
    client = MlflowClient()
    client.search_experiments(max_results=1)  # raises on bad URI / auth
    return uri


def _check_artifact_bucket() -> str | None:
    location = os.environ.get("MLFLOW_ARTIFACT_LOCATION")
    if not location:
        return None
    parsed = urlparse(location)
    if parsed.scheme != "s3":
        raise ValueError(
            f"MLFLOW_ARTIFACT_LOCATION must be an s3:// URI, got {location!r}",
        )
    bucket = parsed.netloc
    prefix = parsed.path.strip("/")
    endpoint = os.environ.get("MLFLOW_S3_ENDPOINT_URL")
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "auto"),
    )

    # R2 S3 tokens commonly grant object-level read/write on selected buckets.
    # Probe the exact operations MLflow artifact logging needs instead of a
    # bucket-level HeadBucket call, which can fail for object-scoped tokens.
    marker_prefix = f"{prefix}/_bootstrap" if prefix else "_bootstrap"
    marker_key = f"{marker_prefix}/mlflow-bootstrap-{uuid4().hex}.txt"
    s3.put_object(
        Bucket=bucket,
        Key=marker_key,
        Body=b"sharkpark mlflow bootstrap\n",
        ContentType="text/plain",
    )
    try:
        s3.head_object(Bucket=bucket, Key=marker_key)
    finally:
        s3.delete_object(Bucket=bucket, Key=marker_key)

    return f"s3://{bucket}/{prefix}" if prefix else f"s3://{bucket}"


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    configure_mlflow()

    print("\n=== SharkPark MLflow bootstrap ===\n")

    try:
        tracking_uri = _check_tracking_uri()
        print(f"  [OK] tracking URI reachable: {_redact(tracking_uri)}")
    except Exception as exc:  # noqa: BLE001 — surface any MLflow/SQLAlchemy error
        print(f"  [FAIL] tracking URI not reachable: {exc}", file=sys.stderr)
        return 1

    try:
        bucket = _check_artifact_bucket()
        if bucket is None:
            print(
                "  [WARN] MLFLOW_ARTIFACT_LOCATION not set — artifacts will land "
                "under the tracking server's default file store. OK for local "
                "dev, NOT acceptable for prod.",
            )
        else:
            print(f"  [OK] R2 artifact bucket reachable: {bucket}")
    except (BotoCoreError, ClientError, ValueError) as exc:
        print(f"  [FAIL] artifact bucket unreachable: {exc}", file=sys.stderr)
        return 1

    for name in PRODUCTION_EXPERIMENTS:
        try:
            exp_id = ensure_experiment(name)
            print(f"  [OK] experiment ensured: {name} (id={exp_id})")
        except Exception as exc:  # noqa: BLE001
            print(f"  [FAIL] could not create experiment {name!r}: {exc}", file=sys.stderr)
            return 1

    print("\nBootstrap complete.\n")
    return 0


def _redact(uri: str) -> str:
    """Best-effort redaction of credentials embedded in a URI."""
    try:
        parsed = urlparse(uri)
        if parsed.password:
            netloc = parsed.netloc.replace(f":{parsed.password}@", ":***@")
            return parsed._replace(netloc=netloc).geturl()
    except Exception:  # noqa: BLE001
        pass
    return uri


if __name__ == "__main__":
    sys.exit(main())
