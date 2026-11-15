"""Fetch → normalise → classify → upsert, one source at a time."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
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
    def upsert(
        self,
        source_name: str,
        jobs: list[NormalizedJob],
        close_missing: bool,
        *,
        allow_empty: bool = False,
        force_close: bool = False,
        keep_ids: Sequence[str] = (),
        fetched_count: int = 0,
    ) -> Mapping[str, object]: ...
    def log_run(self, report: SourceReport) -> None: ...


def select_jobs(result: FetchResult, source: SourceConfig, report: SourceReport) -> list[NormalizedJob]:
    jobs: dict[str, NormalizedJob] = {}
    for posting in result.postings:
        body = f"{posting.department or ''}\n{html_to_markdown(posting.description_html)}"
        if not assess_relevance(posting.title, body).relevant:
            continue
        job = normalize(posting, source)
        if job is None:
            report.rejected_by_normalizer += 1
            report.unknown_ids.append(posting.external_id)
            continue
        jobs[job.external_id] = job
    return list(jobs.values())


def run_source(
    source: SourceConfig,
    fetcher: Fetcher,
    client: httpx.Client,
    database: Database | None,
    force_close: bool = False,
) -> SourceReport:
    """Runs one source and, when a database is supplied, always logs the
    outcome to `ingestion_runs` — including failures — so a source that has
    gone quiet or started erroring is visible without reading CI logs."""
    started_at = datetime.now(timezone.utc)
    report = _run_source(source, fetcher, client, database, force_close)
    report.started_at = started_at
    report.finished_at = datetime.now(timezone.utc)

    if database is not None:
        try:
            database.log_run(report)
        except (DatabaseError, httpx.HTTPError) as exc:
            # Observability must never take down ingestion itself.
            log.error("%s: failed to log ingestion run: %s", source.source_name, exc)

    return report


def _run_source(
    source: SourceConfig,
    fetcher: Fetcher,
    client: httpx.Client,
    database: Database | None,
    force_close: bool = False,
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

    if report.rejected_by_normalizer:
        # Distinct from "gone": these postings are still listed upstream but
        # could not be normalised this run (e.g. a too-short description). They
        # are passed as keep ids below so a live job is never closed for it.
        log.warning(
            "%s: %d posting(s) rejected by the normalizer; treating as unknown (not closing): %s",
            source.source_name,
            report.rejected_by_normalizer,
            ", ".join(report.unknown_ids[:10]),
        )

    clean_feed = result.complete and result.malformed == 0

    if not jobs:
        # A feed that had postings but none relevant means the company pulled
        # (or the classifier now rejects) every agent role: close the source's
        # live jobs. An empty or failed fetch (fetched == 0) is
        # indistinguishable from an outage and closes nothing. The database
        # still applies the mass-close cap unless force_close is set.
        report.status = "no_relevant_jobs"
        if not (clean_feed and report.fetched > 0):
            return report
        report.closed_missing = True
        try:
            outcome = database.upsert(
                source.source_name,
                [],
                True,
                allow_empty=True,
                force_close=force_close,
                keep_ids=report.unknown_ids,
                fetched_count=report.fetched,
            )
        except (DatabaseError, httpx.HTTPError) as exc:
            report.status = "db_failed"
            report.error = str(exc)
            log.error("%s: database write failed: %s", source.source_name, exc)
            return report
        _record_outcome(source, report, [outcome])
        return report

    # Closing stale rows is only safe when this call carries the complete,
    # cleanly parsed feed.
    close_missing = clean_feed and len(jobs) <= MAX_BATCH
    report.closed_missing = close_missing

    try:
        outcomes = []
        for start in range(0, len(jobs), MAX_BATCH):
            outcomes.append(
                database.upsert(
                    source.source_name,
                    jobs[start : start + MAX_BATCH],
                    close_missing,
                    force_close=force_close,
                    keep_ids=report.unknown_ids,
                )
            )
    except (DatabaseError, httpx.HTTPError) as exc:
        report.status = "db_failed"
        report.error = str(exc)
        log.error("%s: database write failed: %s", source.source_name, exc)
        return report
    _record_outcome(source, report, outcomes)
    return report


def _record_outcome(source: SourceConfig, report: SourceReport, outcomes: Sequence[Mapping[str, object]]) -> None:
    totals: dict[str, int] = {}
    errors: list[object] = []
    for outcome in outcomes:
        for key in ("inserted", "updated", "skipped", "failed", "closed", "close_skipped", "blocked"):
            value = outcome.get(key, 0)
            totals[key] = totals.get(key, 0) + (value if isinstance(value, int) else 0)
        batch_errors = outcome.get("errors")
        if isinstance(batch_errors, list):
            errors.extend(batch_errors)
    report.database = {**totals, "errors": errors[:50]}
    if totals.get("close_skipped", 0) > 0:
        report.status = "close_skipped"
        report.error = (
            f"mass-close rail: would have closed {totals['close_skipped']} live job(s); "
            "nothing was closed. If the drop is real, re-run with --force-close."
        )
        log.error("ALERT %s: %s", source.source_name, report.error)


def run(
    sources: Sequence[SourceConfig],
    fetchers: Mapping[str, Fetcher],
    client: httpx.Client,
    database: Database | None,
    force_close: bool = False,
) -> list[SourceReport]:
    reports = []
    for source in sources:
        reports.append(run_source(source, fetchers[source.provider], client, database, force_close))
    return reports


def exit_code(reports: Sequence[SourceReport], strict: bool) -> int:
    """0 = success; 1 = a hard failure or a tripped close rail; 2 = nothing succeeded."""
    if not reports:
        return 2
    hard_failures = {"fetch_failed", "db_failed", "close_skipped"} | ({"not_found"} if strict else set())
    if any(report.status == "db_failed" for report in reports):
        return 1
    if all(report.status in {"fetch_failed", "not_found"} for report in reports):
        return 2
    if any(report.status in hard_failures for report in reports):
        return 1
    return 0
