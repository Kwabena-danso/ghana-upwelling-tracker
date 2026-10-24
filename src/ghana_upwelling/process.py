"""Command-line entry point for raw dataset quality checks."""

import argparse
import sys
from pathlib import Path
from typing import Sequence

from .config import load_dataset_requests
from .quality import create_quality_report

DEFAULT_CONFIG = Path(__file__).resolve().with_name("datasets.json")
DEFAULT_INPUT_DIRECTORY = Path("data") / "raw"
DEFAULT_OUTPUT_FILE = Path("data") / "processed" / "quality_report.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate configured raw NetCDF files and inventory their metadata."
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help=f"Dataset request configuration (default: {DEFAULT_CONFIG}).",
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=DEFAULT_INPUT_DIRECTORY,
        help=f"Directory containing raw NetCDF files (default: {DEFAULT_INPUT_DIRECTORY}).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_FILE,
        help=f"Quality report destination (default: {DEFAULT_OUTPUT_FILE}).",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        requests = load_dataset_requests(args.config)
        report = create_quality_report(requests, args.input_dir, args.output)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    summary = report["summary"]
    print(
        f"Quality report: {summary['passed']} passed, {summary['failed']} failed "
        f"across {summary['total_datasets']} datasets. Saved to {args.output}."
    )
    for dataset in report["datasets"]:
        for issue in dataset["issues"]:
            print(f"{dataset['name']}: {issue}", file=sys.stderr)
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
