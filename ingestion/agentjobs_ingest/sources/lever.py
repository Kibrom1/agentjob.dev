"""Lever Postings API: https://github.com/lever/postings-api"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from agentjobs_ingest.http import FetchError, get_json
from agentjobs_ingest.models import FetchResult, RawPosting, Salary
from agentjobs_ingest.sources.base import as_str, collect, parse_epoch_ms, result

BASE_URL = "https://api.lever.co/v0/postings"
PAGE_SIZE = 100
MAX_PAGES = 50


def _salary(value: Any) -> Salary | None:
    if not isinstance(value, Mapping):
        return None
    interval = as_str(value.get("interval"))
    if interval and interval != "per-year-salary":
        return None
    currency = as_str(value.get("currency")).upper()
    minimum, maximum = value.get("min"), value.get("max")
    if not currency:
        return None
    return Salary(
        minimum=int(minimum) if isinstance(minimum, (int, float)) and not isinstance(minimum, bool) else None,
        maximum=int(maximum) if isinstance(maximum, (int, float)) and not isinstance(maximum, bool) else None,
        currency=currency,
    )


def _description(item: Mapping[str, Any]) -> str:
    parts = [as_str(item.get("description"))]
    lists = item.get("lists")
    if isinstance(lists, list):
        for block in lists:
            if not isinstance(block, Mapping):
                continue
            heading = as_str(block.get("text"))
            content = as_str(block.get("content"))
            if heading:
                parts.append(f"<h3>{heading}</h3>")
            if content:
                parts.append(f"<ul>{content}</ul>")
    parts.append(as_str(item.get("additional")))
    return "\n".join(part for part in parts if part)


def parse_posting(item: Mapping[str, Any]) -> RawPosting | None:
    posting_id = as_str(item.get("id"))
    title = as_str(item.get("text"))
    url = as_str(item.get("hostedUrl")) or as_str(item.get("applyUrl"))
    if not posting_id or not title or not url:
        return None

    categories = item.get("categories") if isinstance(item.get("categories"), Mapping) else {}
    workplace = as_str(item.get("workplaceType"))

    return RawPosting(
        external_id=posting_id,
        title=title,
        location=as_str(categories.get("location")),
        description_html=_description(item),
        apply_url=url,
        published_at=parse_epoch_ms(item.get("createdAt")),
        workplace_hint=workplace if workplace and workplace != "unspecified" else as_str(categories.get("location")),
        employment_hint=as_str(categories.get("commitment")) or None,
        department=as_str(categories.get("team")) or None,
        salary=_salary(item.get("salaryRange")),
    )


def fetch(client: httpx.Client, board: str) -> FetchResult:
    postings = []
    malformed = 0
    for page in range(MAX_PAGES):
        data = get_json(
            client,
            f"{BASE_URL}/{board}",
            params={"mode": "json", "skip": page * PAGE_SIZE, "limit": PAGE_SIZE},
        )
        if not isinstance(data, list):
            raise FetchError(f"lever:{board} returned an unexpected payload")
        page_postings, page_malformed = collect(data, parse_posting, "lever")
        postings.extend(page_postings)
        malformed += page_malformed
        if len(data) < PAGE_SIZE:
            return result(postings, malformed)
    raise FetchError(f"lever:{board} exceeded {MAX_PAGES} pages")
