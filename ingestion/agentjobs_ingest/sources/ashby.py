"""Ashby public job board API: https://developers.ashbyhq.com/docs/public-job-posting-api"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from agentjobs_ingest.http import FetchError, get_json
from agentjobs_ingest.models import FetchResult, RawPosting, Salary
from agentjobs_ingest.sources.base import as_str, collect, parse_iso, result

BASE_URL = "https://api.ashbyhq.com/posting-api/job-board"


def _number(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def _salary(compensation: Any) -> Salary | None:
    if not isinstance(compensation, Mapping):
        return None
    components = compensation.get("summaryComponents")
    if not isinstance(components, list):
        return None
    for component in components:
        if not isinstance(component, Mapping):
            continue
        if as_str(component.get("compensationType")) != "Salary":
            continue
        if as_str(component.get("interval")).upper() not in ("1 YEAR", "YEAR", "ANNUAL"):
            continue
        currency = as_str(component.get("currencyCode")).upper()
        if not currency:
            continue
        return Salary(
            minimum=_number(component.get("minValue")),
            maximum=_number(component.get("maxValue")),
            currency=currency,
        )
    return None


def parse_job(item: Mapping[str, Any]) -> RawPosting | None:
    if item.get("isListed") is False:
        return None
    job_id = as_str(item.get("id"))
    title = as_str(item.get("title"))
    url = as_str(item.get("jobUrl")) or as_str(item.get("applyUrl"))
    if not job_id or not title or not url:
        return None

    workplace = as_str(item.get("workplaceType"))
    if not workplace and item.get("isRemote") is True:
        workplace = "Remote"

    return RawPosting(
        external_id=job_id,
        title=title,
        location=as_str(item.get("location")),
        description_html=as_str(item.get("descriptionHtml")),
        apply_url=url,
        published_at=parse_iso(item.get("publishedAt")),
        workplace_hint=workplace or as_str(item.get("location")),
        employment_hint=as_str(item.get("employmentType")) or None,
        department=as_str(item.get("department")) or None,
        salary=_salary(item.get("compensation")),
    )


def fetch(client: httpx.Client, board: str) -> FetchResult:
    data = get_json(client, f"{BASE_URL}/{board}", params={"includeCompensation": "true"})
    if not isinstance(data, Mapping) or not isinstance(data.get("jobs"), list):
        raise FetchError(f"ashby:{board} returned an unexpected payload")
    listed = [item for item in data["jobs"] if not (isinstance(item, Mapping) and item.get("isListed") is False)]
    postings, malformed = collect(listed, parse_job, "ashby")
    return result(postings, malformed)
