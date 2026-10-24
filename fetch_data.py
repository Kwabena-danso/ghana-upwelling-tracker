"""Download configured Copernicus Marine dataset subsets as raw NetCDF files."""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Callable, Sequence


@dataclass(frozen=True)
class DatasetRequest:
    name: str
    dataset_id: str
    variables: tuple[str, ...]


def load_dataset_requests(config_path: Path) -> list[DatasetRequest]:
    try:
        with config_path.open(encoding="utf-8") as config_file:
            config = json.load(config_file)
    except OSError as error:
        raise ValueError(f"Could not read dataset configuration '{config_path}': {error}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Dataset configuration is not valid JSON: {error}") from error

    if not isinstance(config, dict) or not isinstance(config.get("datasets"), list):
        raise ValueError("Configuration must contain a 'datasets' array.")
    if not config["datasets"]:
        raise ValueError("Configuration 'datasets' array must not be empty.")

    requests: list[DatasetRequest] = []
    names: set[str] = set()
    for index, item in enumerate(config["datasets"]):
        location = f"datasets[{index}]"
        if not isinstance(item, dict):
            raise ValueError(f"{location} must be an object.")

        name = item.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", name):
            raise ValueError(f"{location}.name must contain only letters, numbers, underscores, or hyphens.")
        if name in names:
            raise ValueError(f"Dataset name '{name}' is repeated; names must be unique.")

        dataset_id = item.get("dataset_id")
        if not isinstance(dataset_id, str) or not dataset_id.strip():
            raise ValueError(f"{location}.dataset_id is required; add the selected Copernicus dataset ID.")

        variables = item.get("variables")
        if not isinstance(variables, list) or not variables or any(
            not isinstance(variable, str) or not variable.strip() for variable in variables
        ):
            raise ValueError(f"{location}.variables must be a non-empty list of exact variable names.")
        variables = [variable.strip() for variable in variables]
        if len(set(variables)) != len(variables):
            raise ValueError(f"{location}.variables must not contain duplicates.")

        names.add(name)
        requests.append(DatasetRequest(name, dataset_id.strip(), tuple(variables)))

    return requests


def parse_date(value: str, argument_name: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{argument_name} must be a date in YYYY-MM-DD format.") from error
    if parsed.isoformat() != value:
        raise ValueError(f"{argument_name} must be a date in YYYY-MM-DD format.")
    return parsed


def validate_request_range(start_date: str, end_date: str, bbox: Sequence[float]) -> None:
    start = parse_date(start_date, "--start-date")
    end = parse_date(end_date, "--end-date")
    if start > end:
        raise ValueError("--start-date must be on or before --end-date.")
    if len(bbox) != 4:
        raise ValueError("--bbox requires WEST SOUTH EAST NORTH.")

    west, south, east, north = bbox
    if not (-180 <= west <= 360 and -180 <= east <= 360):
        raise ValueError("Bounding-box longitudes must be between -180 and 360 degrees.")
    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise ValueError("Bounding-box latitudes must be between -90 and 90 degrees.")
    if west >= east:
        raise ValueError("The western longitude must be less than the eastern longitude.")
    if south >= north:
        raise ValueError("The southern latitude must be less than the northern latitude.")


def download_datasets(
    requests: Sequence[DatasetRequest],
    start_date: str,
    end_date: str,
    bbox: Sequence[float],
    output_directory: Path,
    subset_function: Callable[..., object] | None = None,
    overwrite: bool = False,
) -> None:
    validate_request_range(start_date, end_date, bbox)
    username = os.getenv("COPERNICUSMARINE_SERVICE_USERNAME")
    password = os.getenv("COPERNICUSMARINE_SERVICE_PASSWORD")
    if not username or not password:
        raise ValueError(
            "Set COPERNICUSMARINE_SERVICE_USERNAME and COPERNICUSMARINE_SERVICE_PASSWORD "
            "in the environment before downloading."
        )

    if subset_function is None:
        try:
            import copernicusmarine
        except ImportError as error:
            raise RuntimeError(
                "Copernicus Marine Toolbox is not installed. Install it with "
                "'python -m pip install copernicusmarine'."
            ) from error
        subset_function = copernicusmarine.subset

    output_directory.mkdir(parents=True, exist_ok=True)
    west, south, east, north = bbox
    for request in requests:
        output_filename = f"{request.name}.nc"
        print(f"Downloading '{request.name}' ({request.dataset_id}) to {output_directory / output_filename}")
        try:
            subset_function(
                dataset_id=request.dataset_id,
                variables=list(request.variables),
                minimum_longitude=west,
                maximum_longitude=east,
                minimum_latitude=south,
                maximum_latitude=north,
                start_datetime=start_date,
                end_datetime=end_date,
                output_directory=str(output_directory),
                output_filename=output_filename,
                file_format="netcdf",
                overwrite=overwrite,
            )
        except Exception as error:
            raise RuntimeError(f"Download failed for configured dataset '{request.name}': {error}") from error
        print(f"Finished '{request.name}'.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download configured Copernicus Marine dataset subsets as raw NetCDF files."
    )
    parser.add_argument("--config", type=Path, required=True, help="Path to the dataset JSON configuration.")
    parser.add_argument("--start-date", required=True, help="Start date in YYYY-MM-DD format.")
    parser.add_argument("--end-date", required=True, help="End date in YYYY-MM-DD format.")
    parser.add_argument(
        "--bbox",
        type=float,
        nargs=4,
        required=True,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        help="Bounding box in degrees: minimum longitude, minimum latitude, maximum longitude, maximum latitude.",
    )
    parser.add_argument("--output-dir", type=Path, default=Path("raw_data"), help="Download destination.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow the Toolbox to overwrite files with the same output filename.",
    )
    return parser


def main(argv: Sequence[str] | None = None, subset_function: Callable[..., object] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
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


if __name__ == "__main__":
    raise SystemExit(main())
