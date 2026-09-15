"""Command line entry point.

    python -m agentjobs_ingest run [--config sources.yaml] [--dry-run] [--source provider:board]
    python -m agentjobs_ingest validate-config [--config sources.yaml]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path

from agentjobs_ingest.config import ConfigError, load_settings, load_sources
from agentjobs_ingest.http import build_client
from agentjobs_ingest.pipeline import exit_code, run
from agentjobs_ingest.sources import SOURCES
from agentjobs_ingest.supabase import IngestionDatabase

DEFAULT_CONFIG = Path(__file__).resolve().parent.parent / "sources.yaml"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agentjobs-ingest", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    commands = parser.add_subparsers(dest="command", required=True)

    run_cmd = commands.add_parser("run", help="fetch boards and upsert relevant jobs")
    run_cmd.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    run_cmd.add_argument("--dry-run", action="store_true", help="fetch and classify without writing to the database")
    run_cmd.add_argument("--source", action="append", default=[], metavar="PROVIDER:BOARD", help="limit to these sources")
    run_cmd.add_argument("--strict", action="store_true", help="treat unknown boards (404) as failures")
    run_cmd.add_argument("--output", type=Path, help="also write the JSON summary to this file")

    validate_cmd = commands.add_parser("validate-config", help="check the sources file and exit")
    validate_cmd.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    try:
        sources = load_sources(args.config)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    if args.command == "validate-config":
        print(f"{len(sources)} sources OK")
        return 0

    if args.source:
        wanted = set(args.source)
        unknown = wanted - {source.source_name for source in sources}
        if unknown:
            print(f"unknown source(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            return 2
        sources = [source for source in sources if source.source_name in wanted]

    database: IngestionDatabase | None = None
    if not args.dry_run:
        try:
            database = IngestionDatabase(load_settings())
        except ConfigError as exc:
            print(f"config error: {exc}", file=sys.stderr)
            return 2

    try:
        with build_client() as client:
            reports = run(sources, SOURCES, client, database)
    finally:
        if database is not None:
            database.close()

    summary = {
        "dry_run": args.dry_run,
        "sources": [report.to_dict() for report in reports],
        "totals": {
            "fetched": sum(report.fetched for report in reports),
            "relevant": sum(report.relevant for report in reports),
            "failed_sources": sum(report.status in {"fetch_failed", "db_failed"} for report in reports),
        },
    }
    text = json.dumps(summary, indent=2, default=str)
    print(text)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    return exit_code(reports, strict=args.strict)
