"""Copernicus Marine raw NetCDF downloads."""

import os
from pathlib import Path
from typing import Callable, Sequence

from .config import DatasetRequest, validate_request_range


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
                "Copernicus Marine Toolbox is not installed. Install the project with "
                "'python -m pip install -e .'."
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
