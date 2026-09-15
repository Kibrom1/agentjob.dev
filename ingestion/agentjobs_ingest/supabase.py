"""Minimal PostgREST RPC client for the ingestion RPC (service role)."""

from __future__ import annotations

from typing import Any

import httpx

from agentjobs_ingest import USER_AGENT
from agentjobs_ingest.config import Settings
from agentjobs_ingest.models import NormalizedJob

#: Mirrors the per-call cap enforced by public.upsert_ingested_jobs.
MAX_BATCH = 2000


class DatabaseError(Exception):
    def __init__(self, message: str, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


def auth_headers(key: str) -> dict[str, str]:
    headers = {"apikey": key}
    # Legacy service_role keys are JWTs and go in Authorization too. The newer
    # sb_secret_ keys are opaque and are accepted via the apikey header only.
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


class IngestionDatabase:
    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self._settings = settings
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0))

    def close(self) -> None:
        self._client.close()

    def upsert(self, source_name: str, jobs: list[NormalizedJob], close_missing: bool) -> dict[str, Any]:
        if len(jobs) > MAX_BATCH:
            raise ValueError(f"at most {MAX_BATCH} jobs per call")
        response = self._client.post(
            f"{self._settings.supabase_url}/rest/v1/rpc/upsert_ingested_jobs",
            headers={
                **auth_headers(self._settings.service_role_key),
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
            json={
                "p_source_name": source_name,
                "p_jobs": [job.to_payload() for job in jobs],
                "p_close_missing": close_missing,
            },
        )
        if response.status_code >= 400:
            code = None
            message = response.text[:500]
            try:
                body = response.json()
                code = body.get("code")
                message = body.get("message", message)
            except ValueError:
                pass
            raise DatabaseError(f"upsert_ingested_jobs failed ({response.status_code}): {message}", response.status_code, code)
        result = response.json()
        if not isinstance(result, dict):
            raise DatabaseError("upsert_ingested_jobs returned an unexpected payload", response.status_code)
        return result
