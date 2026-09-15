import json
from datetime import datetime, timezone

import httpx
import pytest
import respx

from agentjobs_ingest.config import ConfigError, Settings, load_settings, load_sources, parse_sources
from agentjobs_ingest.models import NormalizedJob, SourceReport
from agentjobs_ingest.supabase import MAX_BATCH, DatabaseError, IngestionDatabase, auth_headers


def test_parse_sources_valid():
    sources = parse_sources(
        {"sources": [{"provider": "ashby", "board": "acme", "company": " Acme ", "logo_url": "https://a.example/l.png"}]}
    )
    assert sources[0].source_name == "ashby:acme"
    assert sources[0].company == "Acme"


@pytest.mark.parametrize(
    ("document", "message"),
    [
        ([], "mapping"),
        ({"sources": []}, "no sources"),
        ({"sources": ["x"]}, "must be a mapping"),
        ({"sources": [{"provider": "workday", "board": "a", "company": "A"}]}, "provider"),
        ({"sources": [{"provider": "lever", "board": "Bad Board", "company": "A"}]}, "board"),
        ({"sources": [{"provider": "lever", "board": "a", "company": ""}]}, "company"),
        ({"sources": [{"provider": "lever", "board": "a", "company": "A", "logo_url": "http://insecure.example/x"}]}, "https"),
        ({"sources": [{"provider": "lever", "board": "a", "company": "A", "company_url": "ftp://x"}]}, "http"),
        (
            {"sources": [{"provider": "lever", "board": "a", "company": "A"}, {"provider": "lever", "board": "a", "company": "B"}]},
            "duplicate",
        ),
    ],
)
def test_parse_sources_rejects_bad_config(document, message):
    with pytest.raises(ConfigError, match=message):
        parse_sources(document)


def test_load_sources_file_errors(tmp_path):
    with pytest.raises(ConfigError, match="not found"):
        load_sources(tmp_path / "missing.yaml")
    bad = tmp_path / "bad.yaml"
    bad.write_text("sources: [unclosed", encoding="utf-8")
    with pytest.raises(ConfigError, match="invalid YAML"):
        load_sources(bad)


def test_load_settings():
    settings = load_settings({"SUPABASE_URL": "https://x.supabase.co/", "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_abc"})
    assert settings == Settings("https://x.supabase.co", "sb_secret_abc")
    with pytest.raises(ConfigError, match="SUPABASE_SERVICE_ROLE_KEY"):
        load_settings({"SUPABASE_URL": "https://x.supabase.co"})
    with pytest.raises(ConfigError, match="publishable"):
        load_settings({"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "sb_publishable_x"})
    with pytest.raises(ConfigError, match="absolute"):
        load_settings({"SUPABASE_URL": "x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"})


def test_auth_headers_by_key_type():
    assert auth_headers("sb_secret_abc") == {"apikey": "sb_secret_abc"}
    assert auth_headers("eyJhbGciOi.jwt") == {"apikey": "eyJhbGciOi.jwt", "Authorization": "Bearer eyJhbGciOi.jwt"}


def job(external_id="1"):
    return NormalizedJob(
        external_id=external_id,
        title="Agent Engineer",
        company="Acme",
        location="Remote",
        workplace_type="remote",
        job_type="full_time",
        category_slug="agent-orchestration",
        tags=["LangGraph"],
        description="x" * 60,
        apply_url="https://jobs.example/1",
        published_at=None,
    )


@respx.mock
def test_upsert_posts_rpc_payload():
    route = respx.post("https://x.supabase.co/rest/v1/rpc/upsert_ingested_jobs").respond(
        json={"inserted": 1, "updated": 0, "skipped": 0, "failed": 0, "closed": 0, "errors": []}
    )
    db = IngestionDatabase(Settings("https://x.supabase.co", "sb_secret_abc"), httpx.Client())
    result = db.upsert("lever:acme", [job()], close_missing=True)
    assert result["inserted"] == 1
    request = route.calls.last.request
    assert request.headers["apikey"] == "sb_secret_abc"
    assert "authorization" not in request.headers
    body = json.loads(request.content)
    assert body["p_source_name"] == "lever:acme"
    assert body["p_close_missing"] is True
    assert body["p_jobs"][0]["external_id"] == "1"
    assert body["p_jobs"][0]["tags"] == ["LangGraph"]


@respx.mock
def test_upsert_surfaces_postgrest_errors():
    respx.post("https://x.supabase.co/rest/v1/rpc/upsert_ingested_jobs").respond(
        400, json={"code": "22023", "message": "Refusing to close every job"}
    )
    db = IngestionDatabase(Settings("https://x.supabase.co", "k" * 30), httpx.Client())
    with pytest.raises(DatabaseError) as excinfo:
        db.upsert("lever:acme", [job()], close_missing=True)
    assert excinfo.value.code == "22023"
    assert "Refusing" in str(excinfo.value)


def test_upsert_enforces_batch_cap():
    db = IngestionDatabase(Settings("https://x.supabase.co", "k" * 30), httpx.Client())
    with pytest.raises(ValueError):
        db.upsert("lever:acme", [job(str(i)) for i in range(MAX_BATCH + 1)], close_missing=False)


@respx.mock
def test_log_run_posts_rpc_payload():
    route = respx.post("https://x.supabase.co/rest/v1/rpc/log_ingestion_run").respond(json="00000000-0000-0000-0000-000000000001")
    db = IngestionDatabase(Settings("https://x.supabase.co", "sb_secret_abc"), httpx.Client())
    report = SourceReport(
        source_name="lever:acme",
        status="ok",
        fetched=5,
        relevant=2,
        database={"inserted": 1, "updated": 1, "skipped": 0, "failed": 0, "closed": 0, "errors": []},
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 1, 1, 0, 0, 30, tzinfo=timezone.utc),
    )
    db.log_run(report)
    body = json.loads(route.calls.last.request.content)
    assert body == {
        "p_source_name": "lever:acme",
        "p_status": "ok",
        "p_fetched": 5,
        "p_relevant": 2,
        "p_inserted": 1,
        "p_updated": 1,
        "p_skipped": 0,
        "p_failed": 0,
        "p_closed": 0,
        "p_error": None,
        "p_started_at": "2026-01-01T00:00:00+00:00",
        "p_finished_at": "2026-01-01T00:00:30+00:00",
    }


def test_log_run_requires_timestamps():
    db = IngestionDatabase(Settings("https://x.supabase.co", "k" * 30), httpx.Client())
    with pytest.raises(ValueError, match="started_at/finished_at"):
        db.log_run(SourceReport(source_name="lever:acme"))


@respx.mock
def test_log_run_surfaces_postgrest_errors():
    respx.post("https://x.supabase.co/rest/v1/rpc/log_ingestion_run").respond(500, json={"message": "db is down"})
    db = IngestionDatabase(Settings("https://x.supabase.co", "k" * 30), httpx.Client())
    report = SourceReport(
        source_name="lever:acme",
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    with pytest.raises(DatabaseError, match="db is down"):
        db.log_run(report)
