"""Command-line entry point for configured Copernicus Marine downloads."""

import argparse
import sys
from pathlib import Path
from typing import Callable, Sequence

from .config import load_dataset_requests, validate_request_range
from .download import download_datasets

DEFAULT_CONFIG = Path(__file__).resolve().with_name("datasets.json")
DEFAULT_OUTPUT_DIRECTORY = Path("data") / "raw"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download configured Copernicus Marine dataset subsets as raw NetCDF files."
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help=f"Dataset request configuration (default: {DEFAULT_CONFIG}).",
    )
    parser.add_argument("--start-date", required=True, help="Start date or ISO 8601 datetime.")
    parser.add_argument("--end-date", required=True, help="End date or ISO 8601 datetime.")
    parser.add_argument(
        "--bbox",
        type=float,
        nargs=4,
        required=True,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        help="Bounding box in degrees: minimum longitude, minimum latitude, maximum longitude, maximum latitude.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIRECTORY,
        help=f"Download destination (default: {DEFAULT_OUTPUT_DIRECTORY}).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow the Toolbox to overwrite files with the same output filename.",
    )
    return parser


def main(argv: Sequence[str] | None = None, subset_function: Callable[..., object] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        requests = load_dataset_requests(args.config)
        validate_request_range(args.start_date, args.end_date, args.bbox)
        download_datasets(
            requests,
            args.start_date,
            args.end_date,
            args.bbox,
            args.output_dir,
            subset_function=subset_function,
            overwrite=args.overwrite,
        )
    except (ValueError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0
