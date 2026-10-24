import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ghana_upwelling.config import DatasetRequest
from ghana_upwelling.process import (
    DEFAULT_INPUT_DIRECTORY,
    DEFAULT_OUTPUT_FILE,
    build_parser,
    main,
)
from ghana_upwelling.quality import create_quality_report


@unittest.skipUnless(importlib.util.find_spec("xarray"), "xarray is required for NetCDF tests")
class QualityReportTests(unittest.TestCase):
    def _write_dataset(self, path: Path) -> None:
        import numpy as np
        import xarray as xr

        dataset = xr.Dataset(
            {
                "thetao": (
                    ("time", "latitude", "longitude"),
                    np.ones((2, 2, 3)),
                    {"units": "degrees_C", "long_name": "Sea water potential temperature"},
                )
            },
            coords={
                "time": np.array(["2024-01-01", "2024-01-02"], dtype="datetime64[D]"),
                "latitude": [1.0, 2.0],
                "longitude": [-3.0, -2.0, -1.0],
            },
        )
        dataset.to_netcdf(path, engine="h5netcdf")

    def test_inventories_configured_variables_and_spatial_temporal_coverage(self):
        request = DatasetRequest("temperature", "selected_product", ("thetao",))

        with tempfile.TemporaryDirectory() as temporary_directory:
            input_directory = Path(temporary_directory) / "raw"
            input_directory.mkdir()
            data_file = input_directory / "temperature.nc"
            self._write_dataset(data_file)
            original_bytes = data_file.read_bytes()

            report = create_quality_report(
                [request],
                input_directory,
                Path(temporary_directory) / "processed" / "quality_report.json",
            )

            saved_report = json.loads(
                (Path(temporary_directory) / "processed" / "quality_report.json").read_text(
                    encoding="utf-8"
                )
            )
            unchanged = data_file.read_bytes() == original_bytes

        dataset = report["datasets"][0]
        self.assertEqual(dataset["status"], "passed")
        self.assertEqual(dataset["variables"]["thetao"]["units"], "degrees_C")
        self.assertEqual(dataset["coordinates"]["time"]["start"], "2024-01-01T00:00:00.000000000")
        self.assertEqual(dataset["coordinates"]["time"]["end"], "2024-01-02T00:00:00.000000000")
        self.assertEqual(dataset["coordinates"]["latitude"]["minimum"], 1.0)
        self.assertEqual(dataset["coordinates"]["longitude"]["maximum"], -1.0)
        self.assertFalse(report["processing"]["data_values_scanned"])
        self.assertFalse(report["processing"]["resampling_applied"])
        self.assertFalse(report["processing"]["indices_calculated"])
        self.assertEqual(saved_report["summary"]["passed"], 1)
        self.assertTrue(unchanged)

    def test_reports_missing_files_and_variables_as_failures(self):
        request = DatasetRequest("temperature", "selected_product", ("thetao", "so"))

        with tempfile.TemporaryDirectory() as temporary_directory:
            input_directory = Path(temporary_directory) / "raw"
            input_directory.mkdir()
            self._write_dataset(input_directory / "temperature.nc")

            report = create_quality_report(
                [request],
                input_directory,
                Path(temporary_directory) / "report.json",
            )

            missing_report = create_quality_report(
                [DatasetRequest("wind", "wind_product", ("eastward_wind",))],
                input_directory,
                Path(temporary_directory) / "missing.json",
            )

        dataset = report["datasets"][0]
        self.assertEqual(dataset["status"], "failed")
        self.assertIn("Configured variable 'so' is missing.", dataset["issues"])
        self.assertEqual(report["summary"]["failed"], 1)
        self.assertEqual(missing_report["datasets"][0]["status"], "failed")
        self.assertIn("Raw NetCDF file is missing.", missing_report["datasets"][0]["issues"])

    def test_process_cli_defaults_to_raw_input_and_processed_report(self):
        args = build_parser().parse_args([])

        self.assertEqual(args.input_dir, DEFAULT_INPUT_DIRECTORY)
        self.assertEqual(args.output, DEFAULT_OUTPUT_FILE)

    def test_process_cli_writes_report_and_returns_failure_for_invalid_input(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            input_directory = root / "raw"
            input_directory.mkdir()
            self._write_dataset(input_directory / "temperature.nc")
            config_path = root / "datasets.json"
            config_path.write_text(
                json.dumps(
                    {
                        "datasets": [
                            {
                                "name": "temperature",
                                "dataset_id": "selected_product",
                                "variables": ["thetao"],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            output_file = root / "processed" / "quality_report.json"

            with redirect_stdout(io.StringIO()):
                success_code = main(
                    [
                        "--config",
                        str(config_path),
                        "--input-dir",
                        str(input_directory),
                        "--output",
                        str(output_file),
                    ]
                )
            self.assertEqual(success_code, 0)
            self.assertTrue(output_file.is_file())

            config_path.write_text(
                json.dumps(
                    {
                        "datasets": [
                            {
                                "name": "temperature",
                                "dataset_id": "selected_product",
                                "variables": ["missing_variable"],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                failure_code = main(
                    [
                        "--config",
                        str(config_path),
                        "--input-dir",
                        str(input_directory),
                        "--output",
                        str(output_file),
                    ]
                )
            failed_count = json.loads(output_file.read_text(encoding="utf-8"))["summary"]["failed"]

        self.assertEqual(failure_code, 1)
        self.assertEqual(failed_count, 1)

    def test_process_cli_filters_quality_report_to_selected_dataset(self):
        config = {
            "datasets": [
                {"name": "wind", "dataset_id": "wind_product", "variables": ["eastward_wind"]},
                {
                    "name": "sea_surface_height",
                    "dataset_id": "ssh_product",
                    "variables": ["zos"],
                },
            ]
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            config_path = root / "datasets.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            with patch(
                "ghana_upwelling.process.create_quality_report",
                return_value={
                    "summary": {"passed": 0, "failed": 1, "total_datasets": 1},
                    "datasets": [{"name": "sea_surface_height", "issues": ["Raw file missing."]}],
                },
            ) as create_report:
                with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    exit_code = main(
                        [
                            "--config",
                            str(config_path),
                            "--dataset-name",
                            "sea_surface_height",
                            "--output",
                            str(root / "report.json"),
                        ]
                    )

        self.assertEqual(exit_code, 1)
        selected = create_report.call_args.args[0]
        self.assertEqual([request.name for request in selected], ["sea_surface_height"])


if __name__ == "__main__":
    unittest.main()
