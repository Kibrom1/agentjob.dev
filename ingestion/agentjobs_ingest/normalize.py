"""Converts provider postings into rows the database will accept.

Every limit here mirrors a CHECK constraint in supabase/migrations so a row
that passes normalisation is not rejected by Postgres.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from markdownify import markdownify

from agentjobs_ingest.classify import classify_category, extract_tags
from agentjobs_ingest.config import SourceConfig
from agentjobs_ingest.models import JobType, NormalizedJob, RawPosting, Salary, WorkplaceType

DESCRIPTION_MIN = 50
DESCRIPTION_MAX = 50_000
TITLE_MAX = 140
LOCATION_MAX = 120
URL_MAX = 2048
SALARY_MAX = 10_000_000

_URL_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
_BLANK_LINES = re.compile(r"\n{3,}")
_TRAILING_SPACE = re.compile(r"[ \t]+\n")


def html_to_markdown(html: str) -> str:
    markdown = markdownify(
        html,
        heading_style="ATX",
        bullets="-",
        strip=["img", "script", "style", "iframe", "form", "input", "button"],
    )
    markdown = markdown.replace("\xa0", " ")
    markdown = _TRAILING_SPACE.sub("\n", markdown)
    markdown = _BLANK_LINES.sub("\n\n", markdown)
    return markdown.strip()


def truncate_markdown(markdown: str, limit: int = DESCRIPTION_MAX) -> str:
    if len(markdown) <= limit:
        return markdown
    suffix = "\n\n…"
    cut = markdown[: limit - len(suffix)]
    boundary = cut.rfind("\n\n")
    if boundary > limit // 2:
        cut = cut[:boundary]
    return cut.rstrip() + suffix


def clip(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def infer_workplace(hint: str | None, location: str) -> WorkplaceType:
    for text in (hint or "", location):
        lowered = text.lower()
        if "hybrid" in lowered:
            return "hybrid"
        if "remote" in lowered or "anywhere" in lowered or "distributed" in lowered:
            return "remote"
        if lowered.replace("-", "").replace(" ", "") in ("onsite", "inoffice", "office"):
            return "onsite"
    return "onsite"


_EMPLOYMENT_MAP: dict[str, JobType] = {
    "fulltime": "full_time",
    "full-time": "full_time",
    "full time": "full_time",
    "permanent": "full_time",
    "parttime": "part_time",
    "part-time": "part_time",
    "part time": "part_time",
    "contract": "contract",
    "contractor": "contract",
    "temporary": "contract",
    "freelance": "contract",
    "intern": "internship",
    "internship": "internship",
}


def infer_job_type(hint: str | None, title: str) -> JobType:
    if hint:
        key = hint.strip().lower()
        if key in _EMPLOYMENT_MAP:
            return _EMPLOYMENT_MAP[key]
        for word, job_type in _EMPLOYMENT_MAP.items():
            if word in key:
                return job_type
    lowered = title.lower()
    if re.search(r"\bintern(ship)?\b", lowered):
        return "internship"
    if re.search(r"\b(contract|contractor|freelance)\b", lowered):
        return "contract"
    if re.search(r"\bpart[-\s]time\b", lowered):
        return "part_time"
    return "full_time"


def normalize_salary(salary: Salary | None) -> tuple[int | None, int | None, str]:
    if salary is None or not re.fullmatch(r"[A-Z]{3}", salary.currency):
        return None, None, "USD"
    values = [
        value if value is not None and 0 <= value <= SALARY_MAX else None
        for value in (salary.minimum, salary.maximum)
    ]
    minimum, maximum = values
    if minimum is not None and maximum is not None and maximum < minimum:
        minimum, maximum = maximum, minimum
    if minimum is None and maximum is None:
        return None, None, "USD"
    return minimum, maximum, salary.currency


def normalize(posting: RawPosting, source: SourceConfig) -> NormalizedJob | None:
    """Returns None when the posting cannot satisfy the database constraints."""
    title = clip(posting.title, TITLE_MAX)
    if len(title) < 3:
        return None

    apply_url = posting.apply_url.strip()
    if len(apply_url) > URL_MAX or not _URL_RE.match(apply_url):
        return None

    description = truncate_markdown(html_to_markdown(posting.description_html))
    if len(description) < DESCRIPTION_MIN:
        return None

    workplace = infer_workplace(posting.workplace_hint, posting.location)
    location = clip(posting.location, LOCATION_MAX) or ("Remote" if workplace == "remote" else "Location not specified")
    salary_min, salary_max, currency = normalize_salary(posting.salary)

    published: datetime | None = posting.published_at
    if published is not None and published > datetime.now(timezone.utc):
        published = None

    body = f"{posting.department or ''}\n{description}"
    return NormalizedJob(
        external_id=posting.external_id[:255],
        title=title,
        company=source.company,
        company_url=source.company_url,
        company_logo_url=source.logo_url,
        location=location,
        workplace_type=workplace,
        job_type=infer_job_type(posting.employment_hint, title),
        category_slug=classify_category(title, body),
        tags=extract_tags(title, body),
        description=description,
        apply_url=apply_url,
        published_at=published.isoformat() if published else None,
        salary_min=salary_min,
        salary_max=salary_max,
        salary_currency=currency,
    )
