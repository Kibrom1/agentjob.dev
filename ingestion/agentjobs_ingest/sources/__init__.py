"""Provider registry."""

from agentjobs_ingest.sources import ashby, greenhouse, lever
from agentjobs_ingest.sources.base import Source

SOURCES: dict[str, Source] = {
    "greenhouse": greenhouse.fetch,
    "lever": lever.fetch,
    "ashby": ashby.fetch,
}

__all__ = ["SOURCES", "Source"]
