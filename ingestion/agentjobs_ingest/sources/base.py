"""Common helpers for provider adapters."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from typing import Any, Protocol

import httpx

from agentjobs_ingest.models import FetchResult, RawPosting

log = logging.getLogger(__name__)


class Source(Protocol):
    def __call__(self, client: httpx.Client, board: str) -> FetchResult: ...


def as_str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def parse_epoch_ms(value: Any) -> datetime | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def collect(
    items: Iterable[Any],
    parse: Callable[[Mapping[str, Any]], RawPosting | None],
    provider: str,
) -> tuple[list[RawPosting], int]:
    """Parses items, skipping (and counting) malformed ones."""
    postings: list[RawPosting] = []
    malformed = 0
    for item in items:
        if not isinstance(item, Mapping):
            malformed += 1
            continue
        try:
            posting = parse(item)
        except (KeyError, TypeError, ValueError) as exc:
            log.warning("%s: skipping malformed posting: %s", provider, exc)
            posting = None
        if posting is None:
            malformed += 1
        else:
            postings.append(posting)
    return postings, malformed


def result(postings: list[RawPosting], malformed: int) -> FetchResult:
    return FetchResult(postings=postings, complete=True, malformed=malformed)
