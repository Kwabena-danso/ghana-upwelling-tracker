"""Non-destructive structural quality checks for downloaded NetCDF datasets."""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from .config import DatasetRequest


COORDINATE_NAMES = {
    "time": {"time", "datetime", "date"},
    "latitude": {"latitude", "lat"},
    "longitude": {"longitude", "lon"},
}


def _find_coordinate(dataset: Any, coordinate_kind: str) -> Any | None:
    candidates = []
    for name, variable in dataset.variables.items():
        standard_name = variable.attrs.get("standard_name", "").lower()
        normalized_name = name.lower()
        if standard_name == coordinate_kind or normalized_name in COORDINATE_NAMES[coordinate_kind]:
            candidates.append((standard_name == coordinate_kind, variable))
    if not candidates:
        return None
    return max(candidates, key=lambda candidate: candidate[0])[1]


def _coordinate_summary(coordinate: Any, coordinate_kind: str) -> dict[str, Any]:
    import numpy as np

    values = np.asarray(coordinate.values)
    if values.size == 0:
        raise ValueError(f"{coordinate_kind} coordinate is empty.")

    if coordinate_kind == "time":
        flattened = values.reshape(-1)
        valid = [value for value in flattened if str(value) != "NaT"]
        if not valid:
            raise ValueError("time coordinate contains no valid timestamps.")
        start, end = min(valid), max(valid)
        return {
            "start": start.isoformat() if hasattr(start, "isoformat") else str(start),
            "end": end.isoformat() if hasattr(end, "isoformat") else str(end),
            "count": int(values.size),
            "dimensions": list(coordinate.dims),
        }

    numeric_values = np.asarray(values, dtype=float)
    finite_values = numeric_values[np.isfinite(numeric_values)]
    if finite_values.size == 0:
        raise ValueError(f"{coordinate_kind} coordinate contains no finite values.")
    return {
        "minimum": float(finite_values.min()),
        "maximum": float(finite_values.max()),
        "count": int(values.size),
        "dimensions": list(coordinate.dims),
    }


def _inspect_file(request: DatasetRequest, path: Path) -> dict[str, Any]:
    try:
        import xarray as xr
    except ImportError as error:
        raise RuntimeError(
            "xarray is required to inspect NetCDF files. Install the project dependencies with "
            "'python -m pip install -e .'."
        ) from error

    result: dict[str, Any] = {
        "name": request.name,
        "dataset_id": request.dataset_id,
        "file": str(path),
        "status": "passed",
        "issues": [],
        "variables": {},
    }
    if not path.is_file():
        result["status"] = "failed"
        result["issues"].append("Raw NetCDF file is missing.")
        return result
    if path.stat().st_size == 0:
        result["status"] = "failed"
        result["issues"].append("Raw NetCDF file is empty.")
        return result

    try:
        with xr.open_dataset(path) as dataset:
            result["dimensions"] = {name: int(size) for name, size in dataset.sizes.items()}
            result["available_variables"] = sorted(dataset.data_vars)
            empty_dimensions = [name for name, size in dataset.sizes.items() if size == 0]
            if empty_dimensions:
                result["issues"].append(
                    "Dataset has empty dimensions: " + ", ".join(sorted(empty_dimensions)) + "."
                )

            for variable_name in request.variables:
                if variable_name not in dataset.data_vars:
                    result["issues"].append(f"Configured variable '{variable_name}' is missing.")
                    continue
                variable = dataset[variable_name]
                result["variables"][variable_name] = {
                    "units": variable.attrs.get("units"),
                    "long_name": variable.attrs.get("long_name"),
                    "standard_name": variable.attrs.get("standard_name"),
                    "dimensions": list(variable.dims),
                    "shape": [int(size) for size in variable.shape],
                    "dtype": str(variable.dtype),
                }

            coordinate_summaries = {}
            for coordinate_kind in COORDINATE_NAMES:
                coordinate = _find_coordinate(dataset, coordinate_kind)
                if coordinate is None:
                    result["issues"].append(f"Could not identify a {coordinate_kind} coordinate.")
                    continue
                try:
                    coordinate_summaries[coordinate_kind] = _coordinate_summary(
                        coordinate, coordinate_kind
                    )
                except (TypeError, ValueError) as error:
                    result["issues"].append(str(error))
            result["coordinates"] = coordinate_summaries
    except Exception as error:
        result["issues"].append(f"Could not read NetCDF metadata: {error}")

    if result["issues"]:
        result["status"] = "failed"
    return result


def create_quality_report(
    requests: Sequence[DatasetRequest],
    input_directory: Path,
    output_file: Path,
) -> dict[str, Any]:
    """Inspect configured raw files and write a JSON metadata report."""
    datasets = [
        _inspect_file(request, input_directory / f"{request.name}.nc")
        for request in requests
    ]
    failed_count = sum(dataset["status"] == "failed" for dataset in datasets)
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "processing": {
            "data_values_scanned": False,
            "resampling_applied": False,
            "indices_calculated": False,
        },
        "summary": {
            "total_datasets": len(datasets),
            "passed": len(datasets) - failed_count,
            "failed": failed_count,
        },
        "datasets": datasets,
    }
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report
