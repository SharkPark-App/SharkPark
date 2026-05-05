"""
Tests for the R2 upload path in src/utils/mlflow_utils.py.

Covers:
    - --export-s3=False makes no R2 calls
    - --export-s3=True uploads the four model files then production.json LAST
    - Upload failure is swallowed; promote_model still returns success
    - Missing required artifact aborts before any pointer write

Run from services/ml/:
    python -m pytest tests/utils/test_mlflow_utils.py -v
"""

import json
import logging
from unittest.mock import MagicMock, patch

import pytest

from scripts.promote_short_term import promote
from scripts.train_short_term import train
from src.config import SHORT_TERM_MODEL_NAME
from src.utils.mlflow_utils import _MODEL_ARTIFACT_FILES, _upload_to_r2


@pytest.fixture(autouse=True)
def _use_isolated_mlflow(isolated_mlflow):
    """All tests in this module use isolated MLflow tracking."""


@pytest.fixture()
def trained_run_id(data_parquet):
    return train(data_parquet)


@pytest.fixture()
def r2_env(monkeypatch):
    monkeypatch.setenv("R2_ENDPOINT_URL", "https://fake.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET", "test-bucket")


class TestR2Upload:
    def test_export_s3_false_makes_no_r2_calls(self, trained_run_id):
        """Without --export-s3, boto3 must not be invoked."""
        with patch("boto3.client") as mock_client:
            version = promote(trained_run_id, export_s3=False)
            assert version is not None
            mock_client.assert_not_called()

    def test_export_s3_true_uploads_files_then_pointer_last(
        self, trained_run_id, r2_env
    ):
        """All four model files upload, then production.json is written last."""

        mock_s3 = MagicMock()
        with patch("boto3.client", return_value=mock_s3):
            version = promote(trained_run_id, export_s3=True)
        assert version is not None

        uploaded_filenames = [
            call.args[2].split("/")[-1] for call in mock_s3.upload_file.call_args_list
        ]
        assert sorted(uploaded_filenames) == sorted(
            ["model.json", "model_lower.json", "model_upper.json", "metadata.joblib"]
        )

        # All upload_file calls must complete before put_object (the pointer)
        assert mock_s3.put_object.call_count == 1
        pointer_call = mock_s3.put_object.call_args
        assert (
            pointer_call.kwargs["Key"]
            == f"models/{SHORT_TERM_MODEL_NAME}/production.json"
        )
        assert pointer_call.kwargs["Bucket"] == "test-bucket"

        body = json.loads(pointer_call.kwargs["Body"].decode("utf-8"))
        assert body["model_name"] == SHORT_TERM_MODEL_NAME
        assert body["version"] == str(version)
        assert body["run_id"] == trained_run_id
        assert "promoted_at" in body
        assert body["artifact_path"] == (
            f"s3://test-bucket/models/{SHORT_TERM_MODEL_NAME}/{version}/"
        )

        # Verify ordering: every upload_file call ran before put_object.
        seen_put = False
        for name, _, _ in mock_s3.mock_calls:
            if name == "put_object":
                seen_put = True
            elif name == "upload_file":
                assert not seen_put, (
                    "upload_file ran after put_object - pointer wrote before artifacts"
                )

    def test_upload_failure_does_not_fail_promotion(self, trained_run_id, r2_env):
        """If R2 upload raises, local registration still succeeds."""
        mock_s3 = MagicMock()
        mock_s3.upload_file.side_effect = RuntimeError("R2 unavailable")

        with patch("boto3.client", return_value=mock_s3):
            version = promote(trained_run_id, export_s3=True)

        # Promotion succeeds — local MLflow registry is the source of truth.
        assert version is not None

    def test_missing_r2_env_vars_does_not_fail_promotion(
        self, trained_run_id, monkeypatch, caplog
    ):
        """Missing R2 credentials log a warning but mlflow promotion still succeeds."""
        # Ensure no R2 env vars are set
        for var in ("R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
            monkeypatch.delenv(var, raising=False)

        with caplog.at_level(logging.WARNING):
            version = promote(trained_run_id, export_s3=True)

        assert version is not None
        assert any(
            "Missing required R2 env vars" in r.message for r in caplog.records
        ), "Expected a warning naming the missing R2 env vars"

    def test_promote_is_idempotent_for_same_run_id(self, trained_run_id, r2_env):
        """Re-promoting the same run_id reuses the existing version (no duplicates)."""
        first = promote(trained_run_id, export_s3=False)
        assert first is not None

        # Second call with the same run_id must NOT create a new registry version.
        mock_s3 = MagicMock()
        with patch("boto3.client", return_value=mock_s3):
            second = promote(trained_run_id, export_s3=True)

        assert second == first, "Re-promoting the same run created a duplicate version"

        # R2 upload still ran on the second call (the user asked for --export-s3).
        assert mock_s3.upload_file.call_count == len(_MODEL_ARTIFACT_FILES)
        assert mock_s3.put_object.call_count == 1

    def test_missing_required_artifact_aborts_before_pointer_write(
        self, r2_env, tmp_path
    ):
        """A missing required file must raise before any pointer is written."""
        # Stage only some of the required files
        for name in _MODEL_ARTIFACT_FILES:
            if name == "model.json":
                continue
            (tmp_path / name).write_bytes(b"x")

        mock_s3 = MagicMock()
        with (
            patch("boto3.client", return_value=mock_s3),
            patch(
                "mlflow.artifacts.download_artifacts",
                return_value=str(tmp_path),
            ),
        ):
            with pytest.raises(FileNotFoundError, match="model.json"):
                _upload_to_r2(model_name="m", version="1", run_id="run-xyz")

        # Pointer must NOT be written when artifacts are incomplete
        mock_s3.put_object.assert_not_called()
