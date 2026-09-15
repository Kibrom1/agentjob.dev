import json

import httpx
import pytest
import respx

from agentjobs_ingest import cli
from agentjobs_ingest.config import SourceConfig
from agentjobs_ingest.http import FetchError, NotFoundError
from agentjobs_ingest.models import FetchResult, SourceReport
from agentjobs_ingest.pipeline import exit_code, run, run_source
from agentjobs_ingest.sources import greenhouse
from agentjobs_ingest.supabase import DatabaseError


class FakeDatabase:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def upsert(self, source_name, jobs, close_missing):
        self.calls.append((source_name, jobs, close_missing))
        if self.fail:
            raise DatabaseError("boom", 500)
        return {"inserted": len(jobs), "updated": 0, "skipped": 0, "failed": 0, "closed": 1, "errors": []}


def greenhouse_fetcher(load_fixture):
    def fetch(client, board):
        with respx.mock:
            respx.get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs").respond(json=load_fixture("greenhouse_board.json"))
            return greenhouse.fetch(client, board)

    return fetch


def test_pipeline_filters_normalises_and_upserts(load_fixture, source):
    db = FakeDatabase()
    with httpx.Client() as client:
        report = run_source(source, greenhouse_fetcher(load_fixture), client, db)

    assert report.status == "ok"
    assert report.fetched == 3 and report.malformed == 2
    # Only the agent orchestration role is relevant: payments role lacks signal,
    # account executive is excluded.
    assert report.relevant == 1
    (name, jobs, close_missing), = db.calls
    assert name == "greenhouse:acme"
    assert jobs[0].external_id == "4011"
    assert jobs[0].workplace_type == "hybrid"
    assert jobs[0].category_slug in {"multi-agent-systems", "agent-orchestration"}
    # Malformed rows in the feed make the snapshot untrustworthy: never close.
    assert close_missing is False
    assert report.database["inserted"] == 1


def test_clean_complete_feed_closes_missing(source):
    from agentjobs_ingest.models import RawPosting

    posting = RawPosting(
        external_id="1",
        title="Senior Agent Engineer",
        location="Remote",
        description_html="<p>Build LLM agents with LangGraph, MCP and evals for enterprise customers.</p>",
        apply_url="https://jobs.example/1",
    )
    db = FakeDatabase()
    with httpx.Client() as client:
        report = run_source(source, lambda c, b: FetchResult([posting, posting], complete=True), client, db)
    assert report.closed_missing is True
    assert len(db.calls[0][1]) == 1  # duplicates collapsed by external_id
    assert db.calls[0][2] is True


@pytest.mark.parametrize(
    ("error", "status"),
    [(NotFoundError("x"), "not_found"), (FetchError("x"), "fetch_failed"), (httpx.ReadTimeout("x"), "fetch_failed")],
)
def test_fetch_failures_are_reported_without_db_calls(source, error, status):
    def failing(client, board):
        raise error

    db = FakeDatabase()
    with httpx.Client() as client:
        report = run_source(source, failing, client, db)
    assert report.status == status
    assert db.calls == []


def test_no_relevant_jobs_skips_database(source):
    db = FakeDatabase()
    with httpx.Client() as client:
        report = run_source(source, lambda c, b: FetchResult([], complete=True), client, db)
    assert report.status == "no_relevant_jobs"
    assert db.calls == []


def test_dry_run_and_database_failure(load_fixture, source):
    with httpx.Client() as client:
        dry = run_source(source, greenhouse_fetcher(load_fixture), client, None)
        failed = run_source(source, greenhouse_fetcher(load_fixture), client, FakeDatabase(fail=True))
    assert dry.status == "dry_run" and dry.relevant == 1
    assert failed.status == "db_failed" and "boom" in (failed.error or "")


def test_run_dispatches_by_provider(source):
    other = SourceConfig(provider="lever", board="beta", company="Beta")
    seen = []

    def fake(name):
        def fetch(client, board):
            seen.append((name, board))
            return FetchResult([], complete=True)

        return fetch

    with httpx.Client() as client:
        reports = run([source, other], {"greenhouse": fake("gh"), "lever": fake("lv")}, client, None)
    assert seen == [("gh", "acme"), ("lv", "beta")]
    assert [r.source_name for r in reports] == ["greenhouse:acme", "lever:beta"]


def report(status):
    return SourceReport(source_name="x:y", status=status)


def test_exit_codes():
    assert exit_code([report("ok"), report("not_found")], strict=False) == 0
    assert exit_code([report("ok"), report("not_found")], strict=True) == 1
    assert exit_code([report("ok"), report("fetch_failed")], strict=False) == 1
    assert exit_code([report("ok"), report("db_failed")], strict=False) == 1
    assert exit_code([report("fetch_failed"), report("not_found")], strict=False) == 2
    assert exit_code([report("dry_run")], strict=False) == 0
    assert exit_code([], strict=False) == 2


def test_cli_dry_run_end_to_end(tmp_path, load_fixture, capsys, monkeypatch):
    config = tmp_path / "sources.yaml"
    config.write_text("sources:\n  - provider: greenhouse\n    board: acme\n    company: Acme AI\n", encoding="utf-8")
    output = tmp_path / "summary.json"
    monkeypatch.delenv("SUPABASE_URL", raising=False)

    with respx.mock:
        respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs").respond(json=load_fixture("greenhouse_board.json"))
        code = cli.main(["run", "--dry-run", "--config", str(config), "--output", str(output)])

    assert code == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["dry_run"] is True
    assert summary["totals"] == {"fetched": 3, "relevant": 1, "failed_sources": 0}
    assert json.loads(output.read_text()) == summary


def test_cli_requires_credentials_for_live_runs(tmp_path, monkeypatch, capsys):
    config = tmp_path / "sources.yaml"
    config.write_text("sources:\n  - provider: lever\n    board: acme\n    company: Acme\n", encoding="utf-8")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    assert cli.main(["run", "--config", str(config)]) == 2
    assert "SUPABASE_URL" in capsys.readouterr().err


def test_cli_rejects_unknown_source_filter(tmp_path, capsys):
    config = tmp_path / "sources.yaml"
    config.write_text("sources:\n  - provider: lever\n    board: acme\n    company: Acme\n", encoding="utf-8")
    assert cli.main(["run", "--dry-run", "--config", str(config), "--source", "ashby:nope"]) == 2
    assert "unknown source" in capsys.readouterr().err


def test_bundled_sources_file_is_valid(capsys):
    assert cli.main(["validate-config"]) == 0
    assert "sources OK" in capsys.readouterr().out
