"""Configuration loading and validation for Copernicus Marine requests."""

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence


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
        names.add(name)

        dataset_id = item.get("dataset_id")
        variables = item.get("variables")
        if not isinstance(variables, list) or any(
            not isinstance(variable, str) or not variable.strip() for variable in variables
        ):
            raise ValueError(f"{location}.variables must be a list of exact variable names.")
        variables = [variable.strip() for variable in variables]
        if len(set(variables)) != len(variables):
            raise ValueError(f"{location}.variables must not contain duplicates.")

        if dataset_id is None and not variables:
            continue
        if not isinstance(dataset_id, str) or not dataset_id.strip():
            raise ValueError(f"{location}.dataset_id is required when variables are configured.")
        if not variables:
            raise ValueError(f"{location}.variables must be non-empty when a dataset ID is configured.")

        requests.append(DatasetRequest(name, dataset_id.strip(), tuple(variables)))

    if not requests:
        raise ValueError("Configure at least one dataset ID and its variables before downloading.")

    return requests


def select_dataset_requests(
    requests: Sequence[DatasetRequest],
    selected_names: Sequence[str] | None,
) -> list[DatasetRequest]:
    if not selected_names:
        return list(requests)
    configured_names = {request.name for request in requests}
    unknown_names = sorted(set(selected_names) - configured_names)
    if unknown_names:
        raise ValueError(
            "Unknown dataset name(s): "
            + ", ".join(unknown_names)
            + ". Configured names: "
            + ", ".join(sorted(configured_names))
            + "."
        )
    requested_names = set(selected_names)
    return [request for request in requests if request.name in requested_names]


def parse_datetime(value: str, argument_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{argument_name} must be an ISO 8601 date or datetime.") from error
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def validate_request_range(start_date: str, end_date: str, bbox: Sequence[float]) -> None:
    start = parse_datetime(start_date, "--start-date")
    end = parse_datetime(end_date, "--end-date")
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
