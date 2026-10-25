"""Derive surface geostrophic velocities from sea-surface-height gradients."""

import argparse
import base64
import json
import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Sequence

from .quality import COORDINATE_NAMES

GRAVITY = 9.80665
EARTH_ROTATION_RATE = 7.292115e-5
EARTH_RADIUS_METERS = 6_371_000.0
DEFAULT_MINIMUM_CORIOLIS = 1e-5
DEFAULT_INPUT_FILE = Path("data") / "raw" / "sea_surface_height.nc"
DEFAULT_OUTPUT_FILE = Path("data") / "processed" / "geostrophic_velocity.nc"
DEFAULT_DASHBOARD_FILE = Path("data") / "processed" / "geostrophic_velocity.js"


def _coordinate_name(dataset: Any, kind: str) -> str:
    for name, coordinate in dataset.variables.items():
        if (
            coordinate.attrs.get("standard_name", "").lower() == kind
            or name.lower() in COORDINATE_NAMES[kind]
        ):
            if coordinate.ndim == 1:
                return name
    raise ValueError(f"Could not identify a one-dimensional {kind} coordinate.")


def _validate_monotonic_coordinate(values: Any, name: str, minimum_size: int = 3) -> None:
    import numpy as np

    numeric_values = np.asarray(values, dtype=float)
    if numeric_values.size < minimum_size or not np.isfinite(numeric_values).all():
        raise ValueError(f"Coordinate '{name}' must contain at least {minimum_size} finite values.")
    differences = np.diff(numeric_values)
    if not (np.all(differences > 0) or np.all(differences < 0)):
        raise ValueError(f"Coordinate '{name}' must be strictly monotonic with no duplicate values.")


def _write_dashboard_snapshot(dataset: Any, output_file: Path, stride: int) -> None:
    import numpy as np

    latitude_name = dataset.attrs["latitude_coordinate"]
    longitude_name = dataset.attrs["longitude_coordinate"]
    latitude = dataset[latitude_name].values
    longitude = dataset[longitude_name].values

    def coordinate_edges(coordinates: Any) -> Any:
        edges = np.empty(coordinates.size + 1, dtype=float)
        edges[1:-1] = (coordinates[:-1] + coordinates[1:]) / 2
        edges[0] = coordinates[0] - (coordinates[1] - coordinates[0]) / 2
        edges[-1] = coordinates[-1] + (coordinates[-1] - coordinates[-2]) / 2
        return edges

    latitude_edges = coordinate_edges(latitude)
    longitude_edges = coordinate_edges(longitude)
    eastward = dataset["eastward_geostrophic_velocity"].values
    northward = dataset["northward_geostrophic_velocity"].values
    speed = dataset["geostrophic_speed"].values
    if "time" not in dataset["geostrophic_speed"].dims:
        eastward = eastward[np.newaxis, ...]
        northward = northward[np.newaxis, ...]
        speed = speed[np.newaxis, ...]
    field_values = np.stack((eastward, northward, speed), axis=-1)
    valid_grid = np.any(np.all(np.isfinite(field_values), axis=-1), axis=0)
    cells = []
    for row, latitude_value in enumerate(latitude):
        for column, longitude_value in enumerate(longitude):
            if not valid_grid[row, column]:
                continue
            cells.append(
                {
                    "latitude": float(latitude_value),
                    "longitude": float(longitude_value),
                    "bounds": [
                        float(min(latitude_edges[row], latitude_edges[row + 1])),
                        float(min(longitude_edges[column], longitude_edges[column + 1])),
                        float(max(latitude_edges[row], latitude_edges[row + 1])),
                        float(max(longitude_edges[column], longitude_edges[column + 1])),
                    ],
                    "row": row,
                    "column": column,
                }
            )

    latest_fields = field_values[-1]
    vectors = []
    for row in range(0, latitude.size, stride):
        for column in range(0, longitude.size, stride):
            east, north, magnitude = map(float, latest_fields[row, column])
            if not all(math.isfinite(value) for value in (east, north, magnitude)):
                continue
            vectors.append(
                {
                    "latitude": float(latitude[row]),
                    "longitude": float(longitude[column]),
                    "bounds": [
                        float(min(latitude_edges[row], latitude_edges[row + 1])),
                        float(min(longitude_edges[column], longitude_edges[column + 1])),
                        float(max(latitude_edges[row], latitude_edges[row + 1])),
                        float(max(longitude_edges[column], longitude_edges[column + 1])),
                    ],
                    "eastward": east,
                    "northward": north,
                    "speed": magnitude,
                }
            )

    timestamps = []
    if "time" in dataset.coords and dataset.sizes.get("time", 0):
        timestamps = [str(value).split("T", 1)[0] for value in dataset["time"].values]
    if not timestamps:
        timestamps = [None]
    packed_values = np.asarray(field_values[:, valid_grid, :], dtype="<f4").tobytes(order="C")
    snapshot = {
        "date": timestamps[-1],
        "method": "surface geostrophic velocity from SSH gradients",
        "citation": "Jacox et al. (2018), https://doi.org/10.1029/2018JC014187",
        "interpretation": (
            "SSH-gradient velocity adaptation; not a CUTI or BEUTI calculation. "
            "Values where |f| is below the configured threshold are masked."
        ),
        "minimum_coriolis_s-1": dataset.attrs["minimum_absolute_coriolis_parameter_s-1"],
        "latitude_extent": [
            float(np.min(dataset[latitude_name].values)),
            float(np.max(dataset[latitude_name].values)),
        ],
        "longitude_extent": [
            float(np.min(dataset[longitude_name].values)),
            float(np.max(dataset[longitude_name].values)),
        ],
        "cells": cells,
        "vectors": vectors,
        "arrow_stride": stride,
        "time_series": {
            "dates": timestamps,
            "encoding": "base64-little-endian-float32-eastward-northward-speed",
            "values": base64.b64encode(packed_values).decode("ascii"),
        },
    }
    encoded = json.dumps(snapshot, separators=(",", ":"), allow_nan=False)
    encoded = encoded.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(output_file, "window.GHANA_GEOSTROPHIC_VELOCITY = " + encoded + ";\n")


def _atomic_write_text(output_file: Path, contents: str) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output_file.parent,
            prefix=output_file.name + ".",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(contents)
        os.replace(temporary_path, output_file)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def derive_geostrophic_velocity(
    input_file: Path,
    output_file: Path,
    dashboard_file: Path | None = DEFAULT_DASHBOARD_FILE,
    minimum_absolute_coriolis: float = DEFAULT_MINIMUM_CORIOLIS,
    dashboard_stride: int = 8,
) -> dict[str, Any]:
    """Write geostrophic velocity fields and a time-series dashboard snapshot."""
    import numpy as np
    import xarray as xr

    if not math.isfinite(minimum_absolute_coriolis) or minimum_absolute_coriolis <= 0:
        raise ValueError("--minimum-absolute-coriolis must be a positive finite value.")
    if dashboard_stride < 1:
        raise ValueError("--dashboard-stride must be at least 1.")
    if not input_file.is_file():
        raise ValueError(f"Sea-surface-height input file does not exist: {input_file}")
    output_paths = [input_file.resolve(), output_file.resolve()]
    if dashboard_file is not None:
        output_paths.append(dashboard_file.resolve())
    if len(set(output_paths)) != len(output_paths):
        raise ValueError("Raw input, NetCDF output, and dashboard snapshot paths must be different.")

    with xr.open_dataset(input_file, chunks="auto") as source:
        if "zos" not in source.data_vars:
            raise ValueError("Sea-surface-height input must contain the configured 'zos' variable.")
        sea_level = source["zos"]
        units = str(sea_level.attrs.get("units", "")).strip().lower()
        if units not in {"m", "meter", "meters", "metre", "metres"}:
            raise ValueError(
                "The 'zos' variable must declare units of metres before velocity can be derived."
            )

        latitude_name = _coordinate_name(source, "latitude")
        longitude_name = _coordinate_name(source, "longitude")
        if latitude_name not in sea_level.dims or longitude_name not in sea_level.dims:
            raise ValueError("'zos' must have both latitude and longitude dimensions.")
        if sea_level.dims[-2:] != (latitude_name, longitude_name):
            raise ValueError("'zos' dimensions must end in latitude, longitude order.")

        latitude_values = source[latitude_name].values
        longitude_values = source[longitude_name].values
        _validate_monotonic_coordinate(latitude_values, latitude_name)
        _validate_monotonic_coordinate(longitude_values, longitude_name)
        if np.any(np.abs(latitude_values) > 90):
            raise ValueError("Latitude coordinates must be within -90 to 90 degrees.")

        latitude_radians = np.deg2rad(source[latitude_name])
        coriolis = 2 * EARTH_ROTATION_RATE * np.sin(latitude_radians)
        dx_per_degree = EARTH_RADIUS_METERS * np.cos(latitude_radians) * (np.pi / 180)
        dy_per_degree = EARTH_RADIUS_METERS * (np.pi / 180)
        d_eta_d_latitude = sea_level.differentiate(latitude_name, edge_order=2) / dy_per_degree
        d_eta_d_longitude = sea_level.differentiate(longitude_name, edge_order=2) / dx_per_degree
        valid_coriolis = abs(coriolis) >= minimum_absolute_coriolis

        eastward = (-GRAVITY * d_eta_d_latitude / coriolis).where(valid_coriolis)
        northward = (GRAVITY * d_eta_d_longitude / coriolis).where(valid_coriolis)
        speed = np.hypot(eastward, northward)

        output = xr.Dataset(
            {
                "eastward_geostrophic_velocity": eastward,
                "northward_geostrophic_velocity": northward,
                "geostrophic_speed": speed,
            },
            attrs={
                "title": "Surface geostrophic velocity derived from Copernicus Marine SSH",
                "method": (
                    "Linear geostrophic balance from the eastward and northward gradients "
                    "of zos; see Jacox et al. (2018), equation 8, for the related "
                    "coastal alongshore-SSH-gradient contribution to CUTI."
                ),
                "citation": "Jacox et al. (2018), https://doi.org/10.1029/2018JC014187",
                "interpretation": (
                    "This is an SSH-gradient geostrophic velocity estimate, not a CUTI or "
                    "BEUTI product. It is not the complete Jacox et al. coastal transport "
                    "calculation."
                ),
                "source_variable": "zos",
                "source_dataset_id": "cmems_mod_glo_phy_my_0.083deg_P1D-m",
                "source_variable_units": units,
                "source_variable_standard_name": str(sea_level.attrs.get("standard_name", "")),
                "source_variable_long_name": str(sea_level.attrs.get("long_name", "")),
                "source_sea_level_reference": str(
                    sea_level.attrs.get(
                        "reference",
                        sea_level.attrs.get("comment", source.attrs.get("references", "")),
                    )
                ),
                "latitude_coordinate": latitude_name,
                "longitude_coordinate": longitude_name,
                "minimum_absolute_coriolis_parameter_s-1": float(minimum_absolute_coriolis),
                "equatorial_mask": (
                    "Grid points with |f| < minimum_absolute_coriolis are NaN; "
                    "this removes latitudes where the standard geostrophic balance "
                    "is ill-conditioned."
                ),
                "earth_radius_m": EARTH_RADIUS_METERS,
                "gravity_m_s-2": GRAVITY,
                "coriolis_parameter_s-1": "f = 2 * 7.292115e-5 * sin(latitude)",
                "velocity_equations": (
                    "u_g = -(g/f) * d(zos)/dy; v_g = (g/f) * d(zos)/dx"
                ),
            },
        )
        output["eastward_geostrophic_velocity"].attrs = {
            "units": "m s-1",
            "standard_name": "eastward_sea_water_geostrophic_velocity",
            "long_name": "Eastward surface geostrophic velocity",
        }
        output["northward_geostrophic_velocity"].attrs = {
            "units": "m s-1",
            "standard_name": "northward_sea_water_geostrophic_velocity",
            "long_name": "Northward surface geostrophic velocity",
        }
        output["geostrophic_speed"].attrs = {
            "units": "m s-1",
            "long_name": "Surface geostrophic speed",
        }

        for coordinate_name in (latitude_name, longitude_name):
            output[coordinate_name].attrs = dict(source[coordinate_name].attrs)
        if "time" in source.coords:
            output["time"].attrs = dict(source["time"].attrs)

        output_file.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=output_file.parent,
                prefix=output_file.stem + ".",
                suffix=output_file.suffix or ".nc",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
            output.to_netcdf(temporary_path, engine="h5netcdf")
            os.replace(temporary_path, output_file)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()

        summary = {
            "input": str(input_file),
            "output": str(output_file),
            "dashboard_output": str(dashboard_file) if dashboard_file else None,
            "time_steps": int(source.sizes.get("time", 1)),
            "latitude_points": int(source.sizes[latitude_name]),
            "longitude_points": int(source.sizes[longitude_name]),
            "minimum_absolute_coriolis_s-1": float(minimum_absolute_coriolis),
            "method": "SSH-gradient surface geostrophic velocity; not CUTI/BEUTI",
        }
        if dashboard_file is not None:
            _write_dashboard_snapshot(output, dashboard_file, dashboard_stride)
        output.close()
        return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Derive surface geostrophic velocity from the configured sea-surface-height "
            "zos variable and create a time-series dashboard snapshot."
        )
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_FILE)
    parser.add_argument(
        "--dashboard-output",
        type=Path,
        default=DEFAULT_DASHBOARD_FILE,
        help="Compressed time-series JavaScript snapshot loaded by the static dashboard.",
    )
    parser.add_argument(
        "--minimum-absolute-coriolis",
        type=float,
        default=DEFAULT_MINIMUM_CORIOLIS,
        help=(
            "Mask grid cells where |f| is below this value in s^-1 "
            f"(default: {DEFAULT_MINIMUM_CORIOLIS:g})."
        ),
    )
    parser.add_argument(
        "--dashboard-stride",
        type=int,
        default=8,
        help="Keep every Nth latitude/longitude point in the dashboard vector overlay.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        summary = derive_geostrophic_velocity(
            args.input,
            args.output,
            args.dashboard_output,
            args.minimum_absolute_coriolis,
            args.dashboard_stride,
        )
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(
        f"Derived {summary['method']} across {summary['time_steps']} time steps; "
        f"masked |f| < {summary['minimum_absolute_coriolis_s-1']:g} s^-1. "
        f"Saved {summary['output']} and dashboard snapshot {summary['dashboard_output']}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
