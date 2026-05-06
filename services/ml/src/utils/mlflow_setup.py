"""
MLflow tracking + artifact store bootstrap.

Configures MLflow once for the process based on environment variables. Both the
GitHub Actions training runner and the backend's Fly cron VM (running inference
via spawned Python child processes) import this module so they share the same
backend store and artifact root.

## Environment

- ``MLFLOW_TRACKING_URI`` (recommended in prod): a SQLAlchemy URL to a Postgres
  database. The MLflow client auto-creates the ``mlruns_*`` tables on first
  connect, so we recommend a *dedicated* database (not the app DB) for clean
  isolation. Example::

      postgresql+psycopg2://mlflow:<pw>@<host>/sharkpark_mlflow?sslmode=require

  When unset, MLflow falls back to the local ``./mlruns`` file store, which is
  fine for ad-hoc development and unit tests.

- ``MLFLOW_ARTIFACT_LOCATION`` (recommended in prod): an ``s3://...`` URI under
  which experiment artifacts are stored. Combined with ``MLFLOW_S3_ENDPOINT_URL``
  + ``AWS_ACCESS_KEY_ID`` + ``AWS_SECRET_ACCESS_KEY``, MLflow writes directly to
  Cloudflare R2. Example::

      s3://sharkpark-ml-exports/mlflow-artifacts

- ``MLFLOW_S3_ENDPOINT_URL``: R2's S3-compatible endpoint
  (``https://<account-id>.r2.cloudflarestorage.com``).

- ``AWS_ACCESS_KEY_ID`` / ``AWS_SECRET_ACCESS_KEY``: R2 token with object
  read+write on the bucket. We deliberately reuse the AWS_* names because the
  ``boto3`` client MLflow uses internally only reads those.

If ``R2_*`` env vars are set (e.g. carried over from earlier dev), this module
mirrors them into the ``AWS_*``/``MLFLOW_S3_ENDPOINT_URL`` variables MLflow
expects, so a single source of truth in ``.env`` works for both code paths.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import mlflow

logger = logging.getLogger(__name__)

__all__ = ["configure_mlflow", "ensure_experiment"]

_CONFIGURED = False


def _mirror_r2_to_aws_env() -> None:
    """Mirror R2_* env vars to the AWS_*/MLFLOW_S3_* names boto3 expects.

    No-op for any name that is already explicitly set, so explicit AWS_* values
    always win. This lets a single ``.env`` with R2_* vars work for both the
    legacy ``upload_model_to_r2`` path (which reads R2_*) and MLflow's S3
    artifact client (which reads AWS_*).
    """
    pairs = (
        ("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
        ("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
        ("R2_ENDPOINT_URL", "MLFLOW_S3_ENDPOINT_URL"),
    )
    for src, dst in pairs:
        src_val = os.environ.get(src)
        if src_val and not os.environ.get(dst):
            os.environ[dst] = src_val

    # boto3 also requires a region; R2 ignores it but the SDK refuses to sign
    # without one. ``auto`` is the conventional value for R2.
    os.environ.setdefault("AWS_DEFAULT_REGION", "auto")


def configure_mlflow() -> None:
    """Idempotent global MLflow configuration.

    Safe to call from module import or repeatedly from script main(). Tests that
    need a temp tracking URI should call ``mlflow.set_tracking_uri(...)`` AFTER
    this — the last call wins.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return

    _mirror_r2_to_aws_env()

    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI")
    if tracking_uri:
        mlflow.set_tracking_uri(tracking_uri)
        logger.info("MLflow tracking URI: %s", _redact(tracking_uri))
    else:
        # Local file store (./mlruns) — MLflow's default. Explicit log so it's
        # obvious why a CI job that forgot to set the secret is writing locally.
        logger.warning(
            "MLFLOW_TRACKING_URI is unset; falling back to local file store. "
            "Production training/inference must set this to a Postgres URI."
        )

    _CONFIGURED = True


def ensure_experiment(name: str) -> str:
    """Get-or-create an experiment with the configured artifact location.

    Unlike ``mlflow.set_experiment``, this guarantees that newly-created
    experiments use ``MLFLOW_ARTIFACT_LOCATION`` as their artifact root. Once
    an experiment exists, MLflow remembers its artifact location forever, so
    the env var only matters at first creation per experiment.

    Returns the experiment_id and also calls ``mlflow.set_experiment(name)`` so
    subsequent ``mlflow.start_run()`` calls land in the right place.
    """
    configure_mlflow()

    artifact_location: Optional[str] = os.environ.get("MLFLOW_ARTIFACT_LOCATION")

    client = mlflow.tracking.MlflowClient()
    existing = client.get_experiment_by_name(name)
    if existing is not None:
        # Experiments are immutable wrt artifact_location after creation. If the
        # operator changed MLFLOW_ARTIFACT_LOCATION mid-flight, log a warning so
        # they know their new value is being ignored for this experiment.
        if artifact_location and existing.artifact_location != artifact_location:
            logger.warning(
                "Experiment %r already exists with artifact_location=%s; "
                "ignoring MLFLOW_ARTIFACT_LOCATION=%s for this experiment. "
                "Create a new experiment name to use the new location.",
                name,
                existing.artifact_location,
                artifact_location,
            )
        mlflow.set_experiment(name)
        return existing.experiment_id

    experiment_id = client.create_experiment(
        name=name,
        artifact_location=artifact_location,  # None falls back to MLflow default
    )
    logger.info(
        "Created MLflow experiment %r (id=%s, artifact_location=%s)",
        name,
        experiment_id,
        artifact_location or "<default>",
    )
    mlflow.set_experiment(name)
    return experiment_id


def _redact(uri: str) -> str:
    """Strip the password from a SQLAlchemy URI for safe logging."""
    if "://" not in uri or "@" not in uri:
        return uri
    scheme, rest = uri.split("://", 1)
    creds, host = rest.split("@", 1)
    if ":" in creds:
        user, _ = creds.split(":", 1)
        creds = f"{user}:***"
    return f"{scheme}://{creds}@{host}"
