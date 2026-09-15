import httpx
import pytest
import respx

from agentjobs_ingest.http import FetchError, NotFoundError, get_json
from agentjobs_ingest.sources import ashby, greenhouse, lever


@pytest.fixture
def client():
    with httpx.Client() as http_client:
        yield http_client


@respx.mock
def test_greenhouse_parses_board_and_counts_malformed(client, load_fixture):
    route = respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs").respond(json=load_fixture("greenhouse_board.json"))
    result = greenhouse.fetch(client, "acme")
    assert route.calls.last.request.url.params["content"] == "true"
    assert result.complete
    assert result.malformed == 2
    assert [p.external_id for p in result.postings] == ["4011", "4012", "4013"]
    first = result.postings[0]
    assert "<strong>multi-agent</strong>" in first.description_html  # entities decoded
    assert first.published_at is not None and first.published_at.isoformat() == "2026-09-01T09:00:00-04:00"
    assert first.department == "Agents"
    assert first.workplace_hint == "San Francisco, CA | Hybrid"


@respx.mock
def test_greenhouse_unexpected_payload(client):
    respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs").respond(json={"error": "nope"})
    with pytest.raises(FetchError):
        greenhouse.fetch(client, "acme")


@respx.mock
def test_lever_paginates_and_maps_fields(client, load_fixture):
    page = load_fixture("lever_postings.json")
    full_page = [dict(page[0], id=f"id-{i}") for i in range(lever.PAGE_SIZE)]
    route = respx.get("https://api.lever.co/v0/postings/acme")
    route.side_effect = [httpx.Response(200, json=full_page), httpx.Response(200, json=page)]

    result = lever.fetch(client, "acme")
    assert route.call_count == 2
    assert route.calls[1].request.url.params["skip"] == str(lever.PAGE_SIZE)
    assert len(result.postings) == lever.PAGE_SIZE + 2

    inference = result.postings[lever.PAGE_SIZE]
    assert inference.workplace_hint == "remote"
    assert inference.employment_hint == "Contract"
    assert inference.salary is not None and inference.salary.currency == "EUR"
    assert "<h3>What you'll do</h3>" in inference.description_html
    assert inference.published_at is not None and inference.published_at.year == 2026


def test_lever_ignores_non_annual_salary():
    posting = lever.parse_posting(
        {"id": "x", "text": "Engineer", "hostedUrl": "https://jobs.lever.co/a/x",
         "salaryRange": {"currency": "USD", "interval": "per-hour-wage", "min": 50, "max": 80}}
    )
    assert posting is not None and posting.salary is None


@respx.mock
def test_ashby_skips_unlisted_and_reads_salary(client, load_fixture):
    respx.get("https://api.ashbyhq.com/posting-api/job-board/acme").respond(json=load_fixture("ashby_board.json"))
    result = ashby.fetch(client, "acme")
    assert [p.title for p in result.postings] == ["Applied AI Engineer", "Founding Engineer, MCP Integrations"]
    applied = result.postings[0]
    assert applied.workplace_hint == "Remote"
    assert applied.employment_hint == "FullTime"
    assert applied.salary is not None
    assert (applied.salary.minimum, applied.salary.maximum, applied.salary.currency) == (120000, 160000, "GBP")
    assert result.postings[1].workplace_hint == "Hybrid"


@respx.mock
def test_get_json_retries_then_succeeds(client):
    sleeps = []
    route = respx.get("https://api.example/jobs")
    route.side_effect = [
        httpx.Response(503),
        httpx.Response(429, headers={"retry-after": "2"}),
        httpx.Response(200, json={"ok": True}),
    ]
    assert get_json(client, "https://api.example/jobs", sleep=sleeps.append) == {"ok": True}
    assert sleeps == [1.0, 2.0]


@respx.mock
def test_get_json_retries_transport_errors_and_gives_up(client):
    route = respx.get("https://api.example/jobs")
    route.side_effect = httpx.ConnectError("boom")
    sleeps = []
    with pytest.raises(FetchError, match="after 3 attempts"):
        get_json(client, "https://api.example/jobs", sleep=sleeps.append)
    assert route.call_count == 3
    assert sleeps == [1.0, 2.0]


@respx.mock
def test_get_json_404_and_non_retryable(client):
    respx.get("https://api.example/missing").respond(404)
    respx.get("https://api.example/forbidden").respond(403)
    respx.get("https://api.example/html").respond(200, text="<html>")
    with pytest.raises(NotFoundError):
        get_json(client, "https://api.example/missing", sleep=lambda _: None)
    with pytest.raises(FetchError, match="HTTP 403"):
        get_json(client, "https://api.example/forbidden", sleep=lambda _: None)
    with pytest.raises(FetchError, match="invalid JSON"):
        get_json(client, "https://api.example/html", sleep=lambda _: None)
