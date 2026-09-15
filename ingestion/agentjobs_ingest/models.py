"""Data shapes shared across the pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Literal

WorkplaceType = Literal["remote", "hybrid", "onsite"]
JobType = Literal["full_time", "part_time", "contract", "internship"]


@dataclass(frozen=True, slots=True)
class Salary:
    minimum: int | None
    maximum: int | None
    currency: str


@dataclass(frozen=True, slots=True)
class RawPosting:
    """A posting as read from a provider, before relevance filtering."""

    external_id: str
    title: str
    location: str
    description_html: str
    apply_url: str
    published_at: datetime | None = None
    workplace_hint: str | None = None
    employment_hint: str | None = None
    department: str | None = None
    salary: Salary | None = None


@dataclass(frozen=True, slots=True)
class NormalizedJob:
    """Payload row for public.upsert_ingested_jobs (keys match the SQL)."""

    external_id: str
    title: str
    company: str
    location: str
    workplace_type: WorkplaceType
    job_type: JobType
    category_slug: str
    tags: list[str]
    description: str
    apply_url: str
    published_at: str | None
    company_url: str | None = None
    company_logo_url: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    salary_currency: str = "USD"

    def to_payload(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class FetchResult:
    postings: list[RawPosting]
    #: True only when every page was read and parsed; gates closing stale jobs.
    complete: bool
    malformed: int = 0


@dataclass(slots=True)
class SourceReport:
    source_name: str
    status: Literal["ok", "not_found", "fetch_failed", "db_failed", "dry_run", "no_relevant_jobs"] = "ok"
    fetched: int = 0
    malformed: int = 0
    relevant: int = 0
    rejected_by_normalizer: int = 0
    closed_missing: bool = False
    database: dict[str, object] = field(default_factory=dict)
    error: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
