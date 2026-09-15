"""Python ↔ SQL contract: normalised rows must be accepted by the real RPC.

Runs only when AGENTJOBS_TEST_DATABASE_URL points at a database with all
migrations applied (scripts/test-db.sh sets it). Everything is rolled back.
"""

import json
import os
import shutil
import subprocess

import pytest

from agentjobs_ingest.config import SourceConfig
from agentjobs_ingest.models import FetchResult, SourceReport
from agentjobs_ingest.pipeline import select_jobs
from agentjobs_ingest.sources import ashby, greenhouse, lever

DATABASE_URL = os.environ.get("AGENTJOBS_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DATABASE_URL or shutil.which("psql") is None,
    reason="set AGENTJOBS_TEST_DATABASE_URL (see scripts/test-db.sh) to run the database contract test",
)


def rows_from_fixtures(load_fixture):
    source = SourceConfig(provider="greenhouse", board="contract", company="Contract Co", logo_url="https://c.example/l.png")
    postings = []
    for item in load_fixture("greenhouse_board.json")["jobs"]:
        if isinstance(item, dict) and (parsed := greenhouse.parse_job(item)):
            postings.append(parsed)
    for item in load_fixture("lever_postings.json"):
        if parsed := lever.parse_posting(item):
            postings.append(parsed)
    for item in load_fixture("ashby_board.json")["jobs"]:
        if parsed := ashby.parse_job(item):
            postings.append(parsed)
    report = SourceReport(source_name=source.source_name)
    jobs = select_jobs(FetchResult(postings, complete=True), source, report)
    assert len(jobs) >= 3, "fixtures should yield several relevant jobs"
    return [job.to_payload() for job in jobs]


def run_sql(sql: str) -> str:
    completed = subprocess.run(
        ["psql", DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    return completed.stdout.strip()


def test_rpc_accepts_every_normalised_row(load_fixture):
    payload = json.dumps(rows_from_fixtures(load_fixture)).replace("'", "''")
    output = run_sql(
        "begin;\n"
        "set local role service_role;\n"
        f"select public.upsert_ingested_jobs('greenhouse:contract', '{payload}'::jsonb, true)::text;\n"
        "rollback;\n"
    )
    result = json.loads(output.splitlines()[-1])
    assert result["failed"] == 0, result["errors"]
    assert result["inserted"] == result["received"]
