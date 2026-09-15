"""Fetch → normalise → classify → upsert, one source at a time."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping, Sequence
from typing import Protocol

import httpx

from agentjobs_ingest.classify import assess_relevance
from agentjobs_ingest.config import SourceConfig
from agentjobs_ingest.http import FetchError, NotFoundError
from agentjobs_ingest.models import FetchResult, NormalizedJob, SourceReport
from agentjobs_ingest.normalize import html_to_markdown, normalize
from agentjobs_ingest.supabase import MAX_BATCH, DatabaseError

log = logging.getLogger(__name__)

Fetcher = Callable[[httpx.Client, str], FetchResult]


class Database(Protocol):
    def upsert(self, source_name: str, jobs: list[NormalizedJob], close_missing: bool) -> Mapping[str, object]: ...


def select_jobs(result: FetchResult, source: SourceConfig, report: SourceReport) -> list[NormalizedJob]:
    jobs: dict[str, NormalizedJob] = {}
    for posting in result.postings:
        body = f"{posting.department or ''}\n{html_to_markdown(posting.description_html)}"
        if not assess_relevance(posting.title, body).relevant:
            continue
        job = normalize(posting, source)
        if job is None:
            report.rejected_by_normalizer += 1
            continue
        jobs[job.external_id] = job
    return list(jobs.values())


def run_source(
    source: SourceConfig,
    fetcher: Fetcher,
    client: httpx.Client,
    database: Database | None,
) -> SourceReport:
    report = SourceReport(source_name=source.source_name)

    try:
        result = fetcher(client, source.board)
    except NotFoundError:
        report.status = "not_found"
        report.error = "board not found (HTTP 404); check the board token"
        log.warning("%s: %s", source.source_name, report.error)
        return report
    except (FetchError, httpx.HTTPError) as exc:
        report.status = "fetch_failed"
        report.error = str(exc)
        log.error("%s: fetch failed: %s", source.source_name, exc)
        return report

    report.fetched = len(result.postings)
    report.malformed = result.malformed
    jobs = select_jobs(result, source, report)
    report.relevant = len(jobs)

    if database is None:
        report.status = "dry_run"
        return report

    if not jobs:
        # The RPC refuses to close every job from an empty list; existing rows
        # simply age out at their expiry date.
        report.status = "no_relevant_jobs"
        return report

    # Closing stale rows is only safe when this call carries the complete,
    # cleanly parsed feed.
    close_missing = result.complete and result.malformed == 0 and len(jobs) <= MAX_BATCH
    report.closed_missing = close_missing

    try:
        totals: dict[str, int] = {}
        errors: list[object] = []
        for start in range(0, len(jobs), MAX_BATCH):
            outcome = database.upsert(source.source_name, jobs[start : start + MAX_BATCH], close_missing)
            for key in ("inserted", "updated", "skipped", "failed", "closed"):
                value = outcome.get(key, 0)
                totals[key] = totals.get(key, 0) + (value if isinstance(value, int) else 0)
            batch_errors = outcome.get("errors")
            if isinstance(batch_errors, list):
                errors.extend(batch_errors)
        report.database = {**totals, "errors": errors[:50]}
    except (DatabaseError, httpx.HTTPError) as exc:
        report.status = "db_failed"
        report.error = str(exc)
        log.error("%s: database write failed: %s", source.source_name, exc)
    return report


def run(
    sources: Sequence[SourceConfig],
    fetchers: Mapping[str, Fetcher],
    client: httpx.Client,
    database: Database | None,
) -> list[SourceReport]:
    reports = []
    for source in sources:
        reports.append(run_source(source, fetchers[source.provider], client, database))
    return reports


def exit_code(reports: Sequence[SourceReport], strict: bool) -> int:
    """0 = success; 1 = a hard failure; 2 = nothing succeeded."""
    if not reports:
        return 2
    hard_failures = {"fetch_failed", "db_failed"} | ({"not_found"} if strict else set())
    if any(report.status == "db_failed" for report in reports):
        return 1
    if all(report.status in {"fetch_failed", "not_found"} for report in reports):
        return 2
    if any(report.status in hard_failures for report in reports):
        return 1
    return 0
