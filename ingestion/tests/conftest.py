import json
from pathlib import Path

import pytest

from agentjobs_ingest.config import SourceConfig

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def load_fixture():
    def _load(name: str):
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

    return _load


@pytest.fixture
def source():
    return SourceConfig(
        provider="greenhouse",
        board="acme",
        company="Acme AI",
        company_url="https://acme.example",
        logo_url="https://acme.example/logo.png",
    )
