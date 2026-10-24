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

The GitHub Actions workflow is manual-only, uses the same dataset inventory, and saves downloads as a 14-day artifact. Configure the two Copernicus credentials as repository secrets and start the workflow with the desired interval and bounds.

After downloading, run `python -m ghana_upwelling.process` to check each configured NetCDF file and write `data/processed/quality_report.json`. The report inventories configured variables, units, dimensions, time coverage, and latitude/longitude extent; missing files, variables, or coordinate metadata are reported as failures. This first processing stage is read-only: it does not scan every data value, resample grids, calculate indices, or connect data to the dashboard. The manual GitHub Actions workflow runs this check and saves the report with the raw-data artifact. `legacy/process_data.py` contains earlier, unvalidated index calculations and is not called by the workflow.

## 🖥️ Dashboard Interface

The static dashboard in `index.html` provides a starting point for exploring a raster layer, coastal communities, time series, and underlying index records. Its current sample dataset is generated in `demo_data.js` and is **synthetic demonstration data only**; it is not sourced from Copernicus Marine and does not contain calculated CUTI/BEUTI observations. The map's raster, coordinate extent, and approximate community points are illustrative, not a real data-coverage footprint or Ghana EEZ boundary.

On desktop, the map remains fixed in the main workspace while the exploration panel scrolls independently through filters, layers, charts, and raw records. Zoom with the map's plus/minus controls or the mouse wheel, and use Reset to restore the full view. Choose CUTI or BEUTI from the map's compact variable dropdown to update its synthetic raster, summary metrics, time-series chart, and the variable column in the raw table. SST, SSH, SOL, and NO3 appear as planned variables but remain disabled until data and units are defined. The community dropdown supports any combination of communities; “All communities” restores the unfiltered view. The “Explore a community” heading and community list are hidden while a point or polygon selection is active, while the community dropdown stays visible so users can switch back to community data. Clearing the drawn selection restores the heading and list. The raw table shows only the currently selected variable; CSV/JSON exports include all matching records and variables. It starts with five rows and can reveal more. On smaller screens the layout stacks and the page scrolls normally. Use the community and date filters to explore the sample records, or draw a point or polygon on the map to sample the illustrative raster. Point selections use the nearest demo cell; polygon selections average the demo cells inside the drawn area. The charts can be downloaded as SVG, and the filtered table can be exported as CSV or JSON. Copernicus Marine integration and verified EEZ geometry have not yet been connected to this interface.

---

## 📂 Repository Structure

```text
├── data/
│   ├── raw/                       # Downloaded NetCDF files (not committed)
│   └── processed/                 # Reserved for validated derived products
├── src/ghana_upwelling/
│   ├── datasets.json              # Packaged core dataset request inventory
│   ├── config.py                  # Request loading and validation
│   ├── download.py                # Copernicus Marine subset downloads
│   ├── quality.py                 # Non-destructive NetCDF checks and inventory
│   ├── process.py                 # Processing/quality-check command
│   └── cli.py                     # Command-line interface and defaults
├── tests/                         # Downloader and configuration tests
├── .github/workflows/             # Manual raw-data download workflow
├── fetch_data.py                  # Compatibility entry point
├── legacy/process_data.py         # Legacy, unvalidated calculations; not in pipeline
└── README.md
```

---

## 📧 Contact & Contributions

Contributions, feedback, and collaboration from physical oceanographers, marine biologists, and data scientists are welcome! Please open an issue or submit a pull request. 

🔬 **Author/Researcher:** [Your Name/GitHub Handle]
🇬🇭 **Focus Region:** Gulf of Guinea (Ecosystem Sub-division 34)
