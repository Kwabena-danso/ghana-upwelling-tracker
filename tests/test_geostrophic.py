import base64
import importlib.util
import json
import re
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ghana_upwelling.geostrophic import (
    DEFAULT_MINIMUM_CORIOLIS,
    derive_geostrophic_velocity,
)


@unittest.skipUnless(
    all(
        importlib.util.find_spec(package)
        for package in ("xarray", "dask")
    ),
    "xarray and dask are required for geostrophic processing tests",
)
class GeostrophicVelocityTests(unittest.TestCase):
    def _write_ssh_file(
        self,
        path: Path,
        units: str = "m",
        latitudes=None,
    ) -> None:
        import numpy as np
        import xarray as xr

        if latitudes is None:
            latitudes = np.array([1.0, 3.0, 5.0, 7.0])
        else:
            latitudes = np.asarray(latitudes, dtype=float)
        longitudes = np.array([-4.0, -2.0, 0.0, 2.0])
        x_meters = (
            6_371_000.0
            * np.cos(np.deg2rad(5.0))
            * np.deg2rad(longitudes)[None, :]
        )
        y_meters = 6_371_000.0 * np.deg2rad(latitudes)[:, None]
        sea_level = (5e-7 * y_meters + 1e-6 * x_meters)[None, :, :]
        sea_level = np.concatenate((sea_level, sea_level * 2), axis=0)
        dataset = xr.Dataset(
            {
                "zos": (
                    ("time", "latitude", "longitude"),
                    sea_level,
                    {"units": units, "standard_name": "sea_surface_height_above_geoid"},
                )
            },
            coords={
                "time": np.array(["2024-01-01", "2024-01-02"], dtype="datetime64[D]"),
                "latitude": latitudes,
                "longitude": longitudes,
            },
        )
        dataset.to_netcdf(path, engine="h5netcdf")

    def test_derives_surface_velocities_for_all_latitudes_and_writes_dashboard_snapshot(self):
        import numpy as np
        import xarray as xr

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            raw_file = root / "sea_surface_height.nc"
            output_file = root / "geostrophic_velocity.nc"
            dashboard_file = root / "geostrophic_velocity.js"
            self._write_ssh_file(raw_file)
            original_bytes = raw_file.read_bytes()

            summary = derive_geostrophic_velocity(
                raw_file,
                output_file,
                dashboard_file,
                minimum_absolute_coriolis=DEFAULT_MINIMUM_CORIOLIS,
                dashboard_stride=2,
            )

            with xr.open_dataset(output_file) as result:
                eastward = result["eastward_geostrophic_velocity"].values
                northward = result["northward_geostrophic_velocity"].values
                speed = result["geostrophic_speed"].values
                attrs = dict(result.attrs)
            dashboard_script = dashboard_file.read_text(encoding="utf-8")
            raw_file_unchanged = raw_file.read_bytes() == original_bytes

        coriolis_at_five = 2 * 7.292115e-5 * np.sin(np.deg2rad(5.0))
        self.assertTrue(np.isfinite(eastward[:, :2, :]).all())
        self.assertTrue(np.isfinite(northward[:, :2, :]).all())
        self.assertAlmostEqual(eastward[0, 2, 1], -9.80665 * 5e-7 / coriolis_at_five, places=6)
        self.assertAlmostEqual(northward[0, 2, 1], 9.80665 * 1e-6 / coriolis_at_five, places=6)
        self.assertAlmostEqual(
            speed[0, 2, 1],
            float(np.hypot(eastward[0, 2, 1], northward[0, 2, 1])),
            places=6,
        )
        self.assertIn("not a CUTI or BEUTI", attrs["interpretation"])
        self.assertEqual(summary["time_steps"], 2)
        self.assertTrue(raw_file_unchanged)

        match = re.fullmatch(
            r"window\.GHANA_GEOSTROPHIC_VELOCITY = (.*);\n",
            dashboard_script,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(match)
        dashboard_data = json.loads(match.group(1))
        self.assertEqual(dashboard_data["date"], "2024-01-02")
        self.assertEqual(dashboard_data["minimum_coriolis_s-1"], DEFAULT_MINIMUM_CORIOLIS)
        self.assertEqual(len(dashboard_data["cells"]), 16)
        self.assertEqual(len(dashboard_data["vectors"]), 4)
        self.assertEqual(dashboard_data["cells"][4]["bounds"], [2.0, -5.0, 4.0, -3.0])
        self.assertEqual(dashboard_data["time_series"]["dates"], ["2024-01-01", "2024-01-02"])
        frame_values = struct.unpack(
            "<96f",
            base64.b64decode(dashboard_data["time_series"]["values"]),
        )
        self.assertAlmostEqual(frame_values[48], frame_values[0] * 2, places=6)

    def test_rejects_unknown_units_and_preserves_raw_file(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            raw_file = root / "sea_surface_height.nc"
            self._write_ssh_file(raw_file, units="cm")
            original_bytes = raw_file.read_bytes()

            with self.assertRaisesRegex(ValueError, "units of metres"):
                derive_geostrophic_velocity(
                    raw_file,
                    root / "derived.nc",
                    dashboard_file=None,
                )
            raw_file_unchanged = raw_file.read_bytes() == original_bytes

        self.assertTrue(raw_file_unchanged)

    def test_explicit_coriolis_threshold_masks_weak_values(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            raw_file = root / "sea_surface_height.nc"
            self._write_ssh_file(raw_file)

            derive_geostrophic_velocity(
                raw_file,
                root / "derived.nc",
                dashboard_file=None,
                minimum_absolute_coriolis=1e-5,
            )

            import xarray as xr
            with xr.open_dataset(root / "derived.nc") as result:
                self.assertTrue(result["geostrophic_speed"].isel(latitude=slice(0, 2)).isnull().all())

    def test_default_configuration_retains_near_equatorial_cells(self):
        import numpy as np
        import xarray as xr

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            raw_file = root / "sea_surface_height.nc"
            self._write_ssh_file(raw_file, latitudes=[0.1, 1.1, 2.1, 3.1])

            derive_geostrophic_velocity(
                raw_file,
                root / "derived.nc",
                dashboard_file=None,
            )

            with xr.open_dataset(root / "derived.nc") as result:
                equatorial_eastward = result["eastward_geostrophic_velocity"].isel(latitude=0).values
                equatorial_northward = result["northward_geostrophic_velocity"].isel(latitude=0).values
                minimum_coriolis = result.attrs["minimum_absolute_coriolis_parameter_s-1"]

        self.assertEqual(minimum_coriolis, DEFAULT_MINIMUM_CORIOLIS)
        self.assertTrue(np.isfinite(equatorial_eastward).all())
        self.assertTrue(np.isfinite(equatorial_northward).all())


if __name__ == "__main__":
    unittest.main()
