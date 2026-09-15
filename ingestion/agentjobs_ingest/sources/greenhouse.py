"""Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html"""

from __future__ import annotations

import html
from collections.abc import Mapping
from typing import Any

import httpx

from agentjobs_ingest.http import FetchError, get_json
from agentjobs_ingest.models import FetchResult, RawPosting
from agentjobs_ingest.sources.base import as_str, collect, parse_iso, result

BASE_URL = "https://boards-api.greenhouse.io/v1/boards"


def parse_job(item: Mapping[str, Any]) -> RawPosting | None:
    job_id = item.get("id")
    title = as_str(item.get("title"))
    url = as_str(item.get("absolute_url"))
    if job_id in (None, "") or not title or not url:
        return None

    location = item.get("location")
    location_name = as_str(location.get("name")) if isinstance(location, Mapping) else ""
    departments = item.get("departments")
    department = ""
    if isinstance(departments, list) and departments and isinstance(departments[0], Mapping):
        department = as_str(departments[0].get("name"))

    # Greenhouse returns the description HTML entity-encoded.
    content = html.unescape(as_str(item.get("content")))

    return RawPosting(
        external_id=str(job_id),
        title=title,
        location=location_name,
        description_html=content,
        apply_url=url,
        published_at=parse_iso(item.get("first_published")) or parse_iso(item.get("updated_at")),
        workplace_hint=location_name,
        department=department or None,
    )


def fetch(client: httpx.Client, board: str) -> FetchResult:
    data = get_json(client, f"{BASE_URL}/{board}/jobs", params={"content": "true"})
    if not isinstance(data, Mapping) or not isinstance(data.get("jobs"), list):
        raise FetchError(f"greenhouse:{board} returned an unexpected payload")
    postings, malformed = collect(data["jobs"], parse_job, "greenhouse")
    return result(postings, malformed)
