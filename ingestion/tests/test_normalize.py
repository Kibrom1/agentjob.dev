from datetime import datetime, timedelta, timezone
import re

import pytest

from agentjobs_ingest.models import RawPosting, Salary
from agentjobs_ingest.normalize import (
    DESCRIPTION_MAX,
    html_to_markdown,
    infer_job_type,
    infer_workplace,
    normalize,
    normalize_salary,
    truncate_markdown,
)

# Mirrors public.are_valid_tags() in the database.
DB_TAG = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9 .+#/-]{0,30}[A-Za-z0-9+#])?$")

DESCRIPTION = "<h1>Role</h1><p>Build <b>LLM agents</b> with LangGraph and MCP tool calling for enterprise workflows.</p>"


def posting(**overrides):
    base = dict(
        external_id="42",
        title="Senior Agent Engineer",
        location="Berlin, Germany",
        description_html=DESCRIPTION,
        apply_url="https://jobs.example/42",
        published_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
    )
    base.update(overrides)
    return RawPosting(**base)


def test_html_to_markdown_strips_unsafe_and_media():
    markdown = html_to_markdown('<p>Hi&nbsp;there</p><img src="x.gif"><script>evil()</script><ul><li>One</li></ul>')
    assert "img" not in markdown and "x.gif" not in markdown
    assert "evil" not in markdown or "<script>" not in markdown
    assert "- One" in markdown
    assert "\xa0" not in markdown


def test_truncate_prefers_paragraph_boundaries():
    text = ("paragraph " * 400 + "\n\n") * 20
    cut = truncate_markdown(text, 10_000)
    assert len(cut) <= 10_000
    assert cut.endswith("…")


def test_truncate_is_noop_when_short():
    assert truncate_markdown("short", DESCRIPTION_MAX) == "short"


@pytest.mark.parametrize(
    ("hint", "location", "expected"),
    [
        ("remote", "", "remote"),
        ("Hybrid", "London", "hybrid"),
        (None, "Remote - US", "remote"),
        (None, "San Francisco, CA | Hybrid", "hybrid"),
        ("OnSite", "NYC", "onsite"),
        (None, "Paris", "onsite"),
        ("", "Anywhere", "remote"),
    ],
)
def test_infer_workplace(hint, location, expected):
    assert infer_workplace(hint, location) == expected


@pytest.mark.parametrize(
    ("hint", "title", "expected"),
    [
        ("FullTime", "Engineer", "full_time"),
        ("Full-time", "Engineer", "full_time"),
        ("PartTime", "Engineer", "part_time"),
        ("Contract", "Engineer", "contract"),
        ("Temporary", "Engineer", "contract"),
        ("Intern", "Engineer", "internship"),
        (None, "ML Engineering Intern", "internship"),
        (None, "Agent Engineer (Contract)", "contract"),
        (None, "Agent Engineer", "full_time"),
        ("Unknown", "Agent Engineer", "full_time"),
    ],
)
def test_infer_job_type(hint, title, expected):
    assert infer_job_type(hint, title) == expected


def test_salary_normalisation():
    assert normalize_salary(None) == (None, None, "USD")
    assert normalize_salary(Salary(150000, 110000, "EUR")) == (110000, 150000, "EUR")
    assert normalize_salary(Salary(None, 90000, "GBP")) == (None, 90000, "GBP")
    assert normalize_salary(Salary(-5, 20_000_000, "USD")) == (None, None, "USD")
    assert normalize_salary(Salary(100, 200, "usd")) == (None, None, "USD")


def test_normalize_produces_database_ready_row(source):
    job = normalize(posting(salary=Salary(120000, 160000, "EUR")), source)
    assert job is not None
    assert job.company == "Acme AI"
    assert job.company_logo_url == "https://acme.example/logo.png"
    assert job.workplace_type == "onsite"
    assert job.job_type == "full_time"
    assert job.category_slug in {"agent-orchestration", "tool-use-backends"}
    assert all(DB_TAG.match(tag) for tag in job.tags)
    assert {"LangGraph", "MCP"} <= set(job.tags)
    assert job.description.startswith("# Role")
    assert job.published_at == "2026-09-01T00:00:00+00:00"
    assert (job.salary_min, job.salary_max, job.salary_currency) == (120000, 160000, "EUR")
    payload = job.to_payload()
    assert set(payload) >= {"external_id", "title", "company", "location", "workplace_type", "job_type",
                            "category_slug", "tags", "description", "apply_url", "published_at"}


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": "  x "},
        {"apply_url": "javascript:alert(1)"},
        {"apply_url": "https://jobs.example/has space"},
        {"description_html": "<p>too short</p>"},
    ],
)
def test_normalize_rejects_rows_the_database_would_refuse(source, overrides):
    assert normalize(posting(**overrides), source) is None


def test_normalize_clips_long_fields_and_fills_location(source):
    job = normalize(posting(title="Agent Engineer " * 20, location="", workplace_hint="Remote"), source)
    assert job is not None
    assert len(job.title) <= 140
    assert job.location == "Remote"
    job = normalize(posting(location=""), source)
    assert job is not None and job.location == "Location not specified"


def test_future_publish_dates_are_dropped(source):
    future = datetime.now(timezone.utc) + timedelta(days=3)
    job = normalize(posting(published_at=future), source)
    assert job is not None and job.published_at is None
