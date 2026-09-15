"""HTTP client with bounded retries for public job-board APIs."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

import httpx

from agentjobs_ingest import USER_AGENT

log = logging.getLogger(__name__)

RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


class NotFoundError(Exception):
    """The board does not exist (HTTP 404)."""


class FetchError(Exception):
    """The request failed after retries or returned an unusable response."""


def build_client(timeout: float = 20.0) -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(timeout),
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        follow_redirects=True,
    )


def get_json(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    attempts: int = 3,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    last_error: str = "no attempts made"
    for attempt in range(1, attempts + 1):
        try:
            response = client.get(url, params=params)
        except httpx.TransportError as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        else:
            if response.status_code == 404:
                raise NotFoundError(url)
            if response.is_success:
                try:
                    return response.json()
                except ValueError as exc:
                    raise FetchError(f"{url} returned invalid JSON") from exc
            if response.status_code not in RETRYABLE_STATUS:
                raise FetchError(f"{url} returned HTTP {response.status_code}")
            last_error = f"HTTP {response.status_code}"
            retry_after = response.headers.get("retry-after", "")
            if attempt < attempts and retry_after.isdigit():
                sleep(min(float(retry_after), 30.0))
                continue

        if attempt < attempts:
            delay = min(2.0 ** (attempt - 1), 10.0)
            log.warning("retrying %s in %.1fs (%s)", url, delay, last_error)
            sleep(delay)

    raise FetchError(f"{url} failed after {attempts} attempts: {last_error}")
