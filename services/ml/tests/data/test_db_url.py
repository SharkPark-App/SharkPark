"""
Tests for `_get_db_url()` Neon pooler URL sanitization (src/data/db.py).

These guard the production-critical URL transformation that lets psycopg2
and SQLAlchemy talk to Neon's pooled endpoint without choking on
Prisma/pool-only query params or libpq-incompatible SSL modes.

Run from services/ml/:
    python -m pytest tests/data/test_db_url.py -v
"""

from urllib.parse import parse_qs, urlparse

import pytest

from src.data import db as db_module


def _params(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query, keep_blank_values=True)


class TestGetDbUrlSanitization:
    """Verify `_get_db_url()` produces a psycopg2-safe Neon URL."""

    def test_strips_pgbouncer_param(self, monkeypatch):
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://u:p@db.neon.tech:5432/sharkpark?pgbouncer=true&sslmode=require",
        )
        out = db_module._get_db_url()
        assert "pgbouncer" not in _params(out)
        assert _params(out)["sslmode"] == ["require"]

    def test_strips_connection_limit_param(self, monkeypatch):
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://u:p@db.neon.tech:5432/sharkpark?connection_limit=10&sslmode=require",
        )
        out = db_module._get_db_url()
        assert "connection_limit" not in _params(out)

    def test_downgrades_verify_full_to_require(self, monkeypatch):
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://u:p@db.neon.tech:5432/sharkpark?sslmode=verify-full&sslrootcert=/etc/ssl/cert.pem",
        )
        out = db_module._get_db_url()
        params = _params(out)
        assert params["sslmode"] == ["require"]
        # sslrootcert must also be removed when downgrading away from verify-*
        assert "sslrootcert" not in params

    def test_downgrades_verify_ca_to_require(self, monkeypatch):
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://u:p@db.neon.tech:5432/sharkpark?sslmode=verify-ca",
        )
        assert _params(db_module._get_db_url())["sslmode"] == ["require"]

    def test_preserves_sslmode_require(self, monkeypatch):
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://u:p@db.neon.tech:5432/sharkpark?sslmode=require",
        )
        assert _params(db_module._get_db_url())["sslmode"] == ["require"]

    def test_preserves_channel_binding(self, monkeypatch):
        # channel_binding is a valid libpq param (not pooler-specific) and
        # Neon's pooled URL ships it by default — we must NOT strip it.
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://u:p@db.neon.tech:5432/sharkpark?sslmode=require&channel_binding=require",
        )
        params = _params(db_module._get_db_url())
        assert params["channel_binding"] == ["require"]

    def test_preserves_host_user_password_path(self, monkeypatch):
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://alice:s3cret@db.neon.tech:5432/sharkpark?pgbouncer=true",
        )
        parsed = urlparse(db_module._get_db_url())
        assert parsed.hostname == "db.neon.tech"
        assert parsed.port == 5432
        assert parsed.username == "alice"
        assert parsed.password == "s3cret"
        assert parsed.path == "/sharkpark"

    def test_real_world_neon_pooled_url(self, monkeypatch):
        """End-to-end shape that matches what Fly secrets actually contain."""
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://sharkpark_owner:abc123@ep-cool-surf-123-pooler.us-west-2.aws.neon.tech:5432/sharkpark"
            "?sslmode=verify-full&sslrootcert=/etc/ssl/cert.pem&pgbouncer=true&connection_limit=10&channel_binding=require",
        )
        out = db_module._get_db_url()
        params = _params(out)
        assert "pgbouncer" not in params
        assert "connection_limit" not in params
        assert "sslrootcert" not in params
        assert params["sslmode"] == ["require"]
        assert params["channel_binding"] == ["require"]
        assert "pooler" in urlparse(out).hostname  # pooler host preserved

    def test_raises_when_database_url_missing(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("DIRECT_URL", raising=False)
        # Also clear any module-level fallback so we exercise the empty path.
        monkeypatch.setattr(db_module, "DATABASE_URL", "", raising=False)
        with pytest.raises(RuntimeError, match="DATABASE_URL"):
            db_module._get_db_url()

    def test_falls_back_to_direct_url_when_database_url_missing(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.setattr(db_module, "DATABASE_URL", "", raising=False)
        monkeypatch.setenv(
            "DIRECT_URL",
            "postgresql://u:p@db.neon.tech:5432/sharkpark?sslmode=require",
        )
        out = db_module._get_db_url()
        assert "db.neon.tech" in out
