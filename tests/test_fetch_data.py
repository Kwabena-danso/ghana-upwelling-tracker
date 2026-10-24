import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fetch_data import (
    DatasetRequest,
    download_datasets,
    load_dataset_requests,
    validate_request_range,
)


class FetchDataTests(unittest.TestCase):
    def test_loads_configured_dataset_ids_and_variables(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            config_path = Path(temporary_directory) / "datasets.json"
            config_path.write_text(
                json.dumps(
                    {
                        "datasets": [
                            {
                                "name": "wind",
                                "dataset_id": "chosen_dataset",
                                "variables": ["chosen_variable"],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            requests = load_dataset_requests(config_path)

        self.assertEqual(
            requests,
            [DatasetRequest("wind", "chosen_dataset", ("chosen_variable",))],
        )

    def test_rejects_unconfigured_dataset_ids_and_variables(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            config_path = Path(temporary_directory) / "datasets.json"
            config_path.write_text(
                json.dumps({"datasets": [{"name": "wind", "dataset_id": None, "variables": []}]}),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "at least one dataset ID"):
                load_dataset_requests(config_path)

    def test_uses_configured_dataset_and_skips_unconfigured_placeholders(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            config_path = Path(temporary_directory) / "datasets.json"
            config_path.write_text(
                json.dumps(
                    {
                        "datasets": [
                            {
                                "name": "sea_surface_height",
                                "dataset_id": "cmems_mod_glo_phy_my_0.083deg_P1D-m",
                                "variables": ["mlotst", "zos"],
                            },
                            {"name": "wind", "dataset_id": None, "variables": []},
                            {"name": "nitrate", "dataset_id": None, "variables": []},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            requests = load_dataset_requests(config_path)

        self.assertEqual(
            requests,
            [
                DatasetRequest(
                    "sea_surface_height",
                    "cmems_mod_glo_phy_my_0.083deg_P1D-m",
                    ("mlotst", "zos"),
                )
            ],
        )

    def test_loads_configured_datasets_from_example_configuration(self):
        requests = load_dataset_requests(Path("copernicus_datasets.example.json"))

        self.assertEqual(
            requests,
            [
                DatasetRequest(
                    "wind",
                    "cmems_obs-wind_glo_phy_my_l4_0.125deg_PT1H",
                    ("eastward_wind", "northward_wind"),
                ),
                DatasetRequest(
                    "sea_surface_height",
                    "cmems_mod_glo_phy_my_0.083deg_P1D-m",
                    ("mlotst", "zos"),
                ),
                DatasetRequest(
                    "nitrate",
                    "cmems_mod_glo_bgc_my_0.25deg_P1D-m",
                    ("no3", "chl", "po4"),
                ),
                DatasetRequest(
                    "sea_surface_temperature",
                    "cmems_mod_glo_phy_my_0.083deg_P1D-m",
                    ("thetao",),
                ),
                DatasetRequest(
                    "salinity",
                    "cmems_mod_glo_phy_my_0.083deg_P1D-m",
                    ("so",),
                ),
            ],
        )

    def test_rejects_partially_configured_dataset(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            config_path = Path(temporary_directory) / "datasets.json"
            config_path.write_text(
                json.dumps({"datasets": [{"name": "wind", "dataset_id": None, "variables": ["u10"]}]}),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "dataset_id is required"):
                load_dataset_requests(config_path)

    def test_validates_dates_and_bounding_box(self):
        validate_request_range("2024-01-01", "2024-01-02", [-4, 2, 2, 7])
        validate_request_range(
            "1993-01-01T00:00:00",
            "2026-09-22T00:00:00",
            [-3.991005, 1.006076, 2.502319, 6.510059],
        )

        with self.assertRaisesRegex(ValueError, "on or before"):
            validate_request_range("2024-01-02", "2024-01-01", [-4, 2, 2, 7])
        with self.assertRaisesRegex(ValueError, "western longitude"):
            validate_request_range("2024-01-01", "2024-01-02", [2, 2, -4, 7])
        with self.assertRaisesRegex(ValueError, "ISO 8601"):
            validate_request_range("01-01-2024", "2024-01-02", [-4, 2, 2, 7])

    def test_passes_configured_values_and_user_range_to_toolbox(self):
        request = DatasetRequest("sample", "selected_dataset", ("variable_a", "variable_b"))
        calls = []

        def fake_subset(**kwargs):
            calls.append(kwargs)

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.dict(
                os.environ,
                {
                    "COPERNICUSMARINE_SERVICE_USERNAME": "test-user",
                    "COPERNICUSMARINE_SERVICE_PASSWORD": "test-password",
                },
            ):
                download_datasets(
                    [request],
                    "2024-01-01",
                    "2024-01-03",
                    [-4, 2, 2, 7],
                    Path(temporary_directory),
                    subset_function=fake_subset,
                )

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["dataset_id"], "selected_dataset")
        self.assertEqual(calls[0]["variables"], ["variable_a", "variable_b"])
        self.assertEqual(calls[0]["start_datetime"], "2024-01-01")
        self.assertEqual(calls[0]["end_datetime"], "2024-01-03")
        self.assertEqual(calls[0]["output_filename"], "sample.nc")
        self.assertEqual(calls[0]["minimum_longitude"], -4)
        self.assertEqual(calls[0]["maximum_latitude"], 7)

    def test_forwards_iso_timestamps_without_truncating(self):
        request = DatasetRequest("sample", "selected_dataset", ("variable_a",))
        calls = []

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.dict(
                os.environ,
                {
                    "COPERNICUSMARINE_SERVICE_USERNAME": "test-user",
                    "COPERNICUSMARINE_SERVICE_PASSWORD": "test-password",
                },
            ):
                download_datasets(
                    [request],
                    "1993-01-01T00:00:00",
                    "2026-09-22T00:00:00",
                    [-3.991005, 1.006076, 2.502319, 6.510059],
                    Path(temporary_directory),
                    subset_function=lambda **kwargs: calls.append(kwargs),
                )

        self.assertEqual(calls[0]["start_datetime"], "1993-01-01T00:00:00")
        self.assertEqual(calls[0]["end_datetime"], "2026-09-22T00:00:00")
        self.assertEqual(calls[0]["minimum_longitude"], -3.991005)
        self.assertEqual(calls[0]["maximum_longitude"], 2.502319)

    def test_stops_and_reports_dataset_when_toolbox_fails(self):
        request = DatasetRequest("sample", "selected_dataset", ("variable_a",))

        def failing_subset(**kwargs):
            raise OSError("network error")

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.dict(
                os.environ,
                {
                    "COPERNICUSMARINE_SERVICE_USERNAME": "test-user",
                    "COPERNICUSMARINE_SERVICE_PASSWORD": "test-password",
                },
            ):
                with self.assertRaisesRegex(RuntimeError, "sample.*network error"):
                    download_datasets(
                        [request],
                        "2024-01-01",
                        "2024-01-03",
                        [-4, 2, 2, 7],
                        Path(temporary_directory),
                        subset_function=failing_subset,
                    )

    def test_requires_credentials_before_download(self):
        request = DatasetRequest("sample", "selected_dataset", ("variable_a",))
        environment = {
            "COPERNICUSMARINE_SERVICE_USERNAME": "",
            "COPERNICUSMARINE_SERVICE_PASSWORD": "",
        }

        with patch.dict(os.environ, environment):
            with self.assertRaisesRegex(ValueError, "COPERNICUSMARINE_SERVICE_USERNAME"):
                download_datasets(
                    [request],
                    "2024-01-01",
                    "2024-01-03",
                    [-4, 2, 2, 7],
                    Path("unused-output"),
                    subset_function=lambda **kwargs: None,
                )


if __name__ == "__main__":
    unittest.main()
