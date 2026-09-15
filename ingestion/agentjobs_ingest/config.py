"""Source list (YAML) and runtime settings (environment)."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import yaml

PROVIDERS = ("greenhouse", "lever", "ashby")
_BOARD_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


class ConfigError(ValueError):
    """Raised for invalid source configuration or missing settings."""


@dataclass(frozen=True, slots=True)
class SourceConfig:
    provider: str
    board: str
    company: str
    company_url: str | None = None
    logo_url: str | None = None

    @property
    def source_name(self) -> str:
        return f"{self.provider}:{self.board}"


@dataclass(frozen=True, slots=True)
class Settings:
    supabase_url: str
    service_role_key: str


def _optional_url(value: object, field: str, index: int, https_only: bool) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ConfigError(f"sources[{index}].{field} must be a string")
    pattern = r"^https://\S+\.\S+$" if https_only else r"^https?://\S+\.\S+$"
    if not re.match(pattern, value):
        scheme = "https" if https_only else "http(s)"
        raise ConfigError(f"sources[{index}].{field} must be an absolute {scheme} URL")
    return value


def parse_sources(document: object) -> list[SourceConfig]:
    if not isinstance(document, Mapping) or not isinstance(document.get("sources"), list):
        raise ConfigError("config must be a mapping with a 'sources' list")

    sources: list[SourceConfig] = []
    seen: set[str] = set()
    for index, item in enumerate(document["sources"]):
        if not isinstance(item, Mapping):
            raise ConfigError(f"sources[{index}] must be a mapping")
        provider = item.get("provider")
        board = item.get("board")
        company = item.get("company")
        if provider not in PROVIDERS:
            raise ConfigError(f"sources[{index}].provider must be one of {', '.join(PROVIDERS)}")
        if not isinstance(board, str) or not _BOARD_RE.match(board) or len(board) > 60:
            raise ConfigError(f"sources[{index}].board must be a lowercase board token")
        if not isinstance(company, str) or not company.strip() or len(company.strip()) > 120:
            raise ConfigError(f"sources[{index}].company must be 1-120 characters")

        source = SourceConfig(
            provider=provider,
            board=board,
            company=company.strip(),
            company_url=_optional_url(item.get("company_url"), "company_url", index, https_only=False),
            logo_url=_optional_url(item.get("logo_url"), "logo_url", index, https_only=True),
        )
        if source.source_name in seen:
            raise ConfigError(f"duplicate source {source.source_name}")
        seen.add(source.source_name)
        sources.append(source)

    if not sources:
        raise ConfigError("config lists no sources")
    return sources


def load_sources(path: Path) -> list[SourceConfig]:
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"config file not found: {path}") from exc
    except yaml.YAMLError as exc:
        raise ConfigError(f"invalid YAML in {path}: {exc}") from exc
    return parse_sources(document)


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    url = env.get("SUPABASE_URL", "").strip().rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    missing = [name for name, value in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key)) if not value]
    if missing:
        raise ConfigError(f"missing environment variables: {', '.join(missing)}")
    if not re.match(r"^https?://\S+$", url):
        raise ConfigError("SUPABASE_URL must be an absolute http(s) URL")
    if key.startswith("sb_publishable_"):
        raise ConfigError("SUPABASE_SERVICE_ROLE_KEY is a publishable key; use the service_role / sb_secret_ key")
    return Settings(supabase_url=url, service_role_key=key)
