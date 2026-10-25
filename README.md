# 🌊 Ghana Upwelling Tracker 🇬🇭

An oceanographic tracking and data analysis project being developed to monitor coastal upwelling dynamics along **Ghana's Exclusive Economic Zone (EEZ)** in the Gulf of Guinea. The current pipeline downloads configured Copernicus Marine datasets and performs structural metadata checks; it does not yet calculate upwelling indices.

---

## 📌 Project Overview

Coastal upwelling along the Northern Gulf of Guinea (specifically the Côte d'Ivoire-Ghana upwelling system) is a critical marine phenomenon. It regulates regional climate, drives primary biological productivity, and sustains local artisanal and industrial fisheries.

<p align="center">
  <img src="images/Screenshot 2026-04-27 235124.png" alt="Ghana EEZ Study Area Map" width="550"/>
  <br>
  <em>Figure 2: Map of the study area along Ghana's Exclusive Economic Zone (EEZ) showing data collection nodes.</em>
</p>

### 🔬 Planned Scientific Methods
Potential future analyses include:
*   **💨 CUTI (Coastal Upwelling Transport Index):** Quantifies the net vertical mass transport of water into the surface mixed layer, assessing the physical strength of the upwelling signal.
*   **🐟 BEAUTI (Biologically Effective Upwelling Transport Index):** Factors in the nutrient concentration of the source water to calculate the actual nitrate/biological flux reaching the euphotic zone.

These calculations are not implemented. Their input variables, units, spatial domains, and scientific formulas must be verified before they are added to the processing pipeline.

---

## 🗺️ Study Area: Ghana's EEZ

The tracking focusing on key coastal nodes where upwelling intensity historically peaks due to orientation of the coastline and bathymetry:
1.  **📍 Cape Three Points (Western Region):** The primary topographic upwelling center.
2.  **📍 Takoradi & Accra Coastal Strips:** Areas heavily influenced by remote forcing and localized wind-stress curl.

<p align="center">
  <img src="https://researchgate.net" alt="Gulf of Guinea SST Map" width="550"/>
  <br>
  <em>Figure 2: Historical Sea Surface Temperature (SST) footprint detailing the distinct cold-water upwelling plumes across Côte d'Ivoire and Ghana.</em>
</p>

---

## 🚀 Key Features

*   📊 **Raw-data pipeline:** Downloads configured Copernicus datasets and checks NetCDF structure and metadata.
*   📈 **Planned analysis:** Index time series, anomaly tracking, and ecological indicators require future scientific-method validation and implementation.

---

## 🛠️ Data Sources & Tech Stack

*   **Core inputs:** Copernicus Marine wind, sea-surface height, nitrate, chlorophyll, phosphate, sea-surface temperature, and salinity.
*   **Language:** Python 🐍
*   **Project packaging:** `pyproject.toml`
*   **Download library:** `copernicusmarine`

## ⬇️ Raw Copernicus Marine Downloads

The five core requests are maintained in the packaged inventory `src/ghana_upwelling/datasets.json`: wind, sea-surface height, nitrate/biogeochemistry, sea-surface temperature, and salinity. Temperature, salinity, and sea-surface-height requests use different variables from the same Copernicus physics dataset and are saved as separate named files.

Install the project and its downloader dependency, then set `COPERNICUSMARINE_SERVICE_USERNAME` and `COPERNICUSMARINE_SERVICE_PASSWORD` in the environment:

```sh
python -m pip install -e .
python -m ghana_upwelling \
  --start-date 1993-01-01T00:00:00 \
  --end-date 2026-09-22T00:00:00 \
  --bbox -3.991005 1.006076 2.502319 6.510059
```

`--config` defaults to the checked-in core dataset inventory, and `--output-dir` defaults to `data/raw/`. Each request is saved separately as `<name>.nc`; the selected interval and geographic bounds are supplied at run time. Use `--overwrite` to replace existing files. The root-level `fetch_data.py` entry point remains available for compatibility.

The GitHub Actions workflow is manual-only, defaults to downloading and processing sea-surface height, and can optionally process all configured datasets. It saves raw files, QC output, and derived velocity products as 14-day artifacts. Configure the two Copernicus credentials as repository secrets and start the workflow with the desired interval and bounds.

To download only the configured sea-surface-height request, append `--dataset-name sea_surface_height` to the fetch command. Then derive surface geostrophic velocities:

```sh
python -m ghana_upwelling \
  --start-date 1993-01-01T00:00:00 \
  --end-date 2026-09-22T00:00:00 \
  --bbox -3.991005 1.006076 2.502319 6.510059 \
  --dataset-name sea_surface_height
python -m ghana_upwelling.geostrophic
```

The geostrophic command reads `data/raw/sea_surface_height.nc` and writes the full time series to `data/processed/geostrophic_velocity.nc` plus a latest-time dashboard snapshot to `data/processed/geostrophic_velocity.js`. The snapshot keeps every valid source-grid cell for the raster and Explore Data, while `--dashboard-stride` only thins the overlaid current arrows. When this snapshot is present, enabling “Geostrophic current map” opens an interactive Leaflet map with the Esri World Street Map basemap, pan/zoom, current vectors, and popups for speed and eastward/northward velocity. Leaflet is loaded from the unpkg CDN; Esri tile attribution is shown on the map. The calculation uses the surface geostrophic balance, `u_g = -(g/f) d(zos)/dy` and `v_g = (g/f) d(zos)/dx`. Grid cells with `|f| < 1e-5 s^-1` (approximately south of 3.9°N here) are set to missing values to avoid amplifying velocities near the equator; the threshold is configurable. This means part of the southern Ghana EEZ extent will have no geostrophic velocities. Review the output metadata and `zos` attributes to interpret its sea-level reference.

This is an SSH-gradient geostrophic-velocity adaptation informed by Jacox et al. (2018), not a reproduction of CUTI/BEUTI. Their paper's CUTI uses cross-shore geostrophic transport from an alongshore coastal SSH gradient together with Ekman transport; the paper's indices are developed for the U.S. West Coast. The present output is a surface velocity field and does not calculate transport or an upwelling index. The configured coordinate rectangle is not itself a verified legal EEZ polygon.

Separately, `python -m ghana_upwelling.process` checks each configured NetCDF file and writes `data/processed/quality_report.json`, inventorying variables, units, dimensions, time coverage, and spatial extent. Missing files, variables, or coordinates are reported as failures. This QC stage does not scan every data value, resample grids, or calculate indices. The manual GitHub Actions workflow runs QC and geostrophic processing and saves their outputs as 14-day artifacts; it does not automatically publish the generated snapshot to a hosted dashboard. `legacy/process_data.py` contains earlier, unvalidated index calculations and is not called by the workflow.

## 🖥️ Dashboard Interface

The dashboard in `index.html` provides a starting point for exploring a scalar raster, coastal communities, time series, and underlying grid values. Its CUTI/BEUTI sample dataset is generated in `demo_data.js` and is **synthetic demonstration data only**; it is not sourced from Copernicus Marine and does not contain calculated CUTI/BEUTI observations. When `data/processed/geostrophic_velocity.js` exists, the dashboard opens on an interactive Leaflet map with a Copernicus SSH-derived speed raster and current-direction arrows. This snapshot contains the latest available date only; it does not include a historical geostrophic time series. The displayed bounds do not represent a verified legal Ghana EEZ boundary.

On desktop, the map remains fixed in the main workspace while the exploration panel scrolls independently through filters, layers, charts, and raw records. Zoom and pan the Copernicus map with Leaflet. Its variable selector switches between geostrophic speed, eastward velocity, northward velocity, and synthetic CUTI/BEUTI examples. The Copernicus raster, spatial summary, chart, grid-cell table, and CSV/JSON exports all use values from the same latest-time snapshot; clicking a raster cell or arrow filters Explore Data to that cell. Choose CUTI or BEUTI to return to the clearly labeled synthetic demonstration raster and records. The Copernicus snapshot is a surface-velocity estimate, not CUTI or BEUTI; it represents one date, and cells masked for weak Coriolis are omitted. Approximate demo community markers can be toggled on the map. In demo mode, point/polygon sampling and community/date filters remain available. SST, SSH, SOL, and NO3 remain unavailable as dashboard variables. The charts can be downloaded as SVG, and the filtered table can be exported as CSV or JSON. The manual workflow does not automatically publish its generated snapshot to a hosted dashboard.

---

## 📂 Repository Structure

```text
├── data/
│   ├── raw/                       # Downloaded NetCDF files (not committed)
│   └── processed/                 # QC reports and derived products (not committed)
├── src/ghana_upwelling/
│   ├── datasets.json              # Packaged core dataset request inventory
│   ├── config.py                  # Request loading and validation
│   ├── download.py                # Copernicus Marine subset downloads
│   ├── geostrophic.py             # SSH-gradient velocity calculation
│   ├── quality.py                 # Non-destructive NetCDF checks and inventory
│   ├── process.py                 # Processing/quality-check command
│   └── cli.py                     # Command-line interface and defaults
├── tests/                         # Downloader and configuration tests
├── .github/workflows/             # Manual download, QC, and geostrophic workflow
├── fetch_data.py                  # Compatibility entry point
├── legacy/process_data.py         # Legacy, unvalidated calculations; not in pipeline
└── README.md
```

---

## 📧 Contact & Contributions

Contributions, feedback, and collaboration from physical oceanographers, marine biologists, and data scientists are welcome! Please open an issue or submit a pull request. 

🔬 **Author/Researcher:** [Your Name/GitHub Handle]
🇬🇭 **Focus Region:** Gulf of Guinea (Ecosystem Sub-division 34)
