# 🌊 Ghana Upwelling Tracker 🇬🇭

An oceanographic tracking and data analysis project monitoring coastal upwelling dynamics along **Ghana's Exclusive Economic Zone (EEZ)** in the Gulf of Guinea. This project leverages the **CUTI (Coastal Upwelling Transport Index)** and **BEAUTI (Biologically Effective Upwelling Transport Index)** frameworks to measure physical water transport and biological ecosystem impacts.

---

## 📌 Project Overview

Coastal upwelling along the Northern Gulf of Guinea (specifically the Côte d'Ivoire-Ghana upwelling system) is a critical marine phenomenon. It regulates regional climate, drives primary biological productivity, and sustains local artisanal and industrial fisheries.

<p align="center">
  <img src="images/Screenshot 2026-04-27 235124.png" alt="Ghana EEZ Study Area Map" width="550"/>
  <br>
  <em>Figure 2: Map of the study area along Ghana's Exclusive Economic Zone (EEZ) showing data collection nodes.</em>
</p>

### 🔬 Core Methodologies
This repository processes satellite, wind, and hydrodynamic data to calculate:
*   **💨 CUTI (Coastal Upwelling Transport Index):** Quantifies the net vertical mass transport of water into the surface mixed layer, assessing the physical strength of the upwelling signal.
*   **🐟 BEAUTI (Biologically Effective Upwelling Transport Index):** Factors in the nutrient concentration of the source water to calculate the actual nitrate/biological flux reaching the euphotic zone.

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

*   📊 **Index Time-Series Parsing:** Automated pipelines to ingest and clean daily wind and sea surface temperature (SST) datasets.
*   📈 **Anomaly Tracking:** Computes localized SST deviations and wind-stress anomalies against long-term climatologies.
*   🐋 **Ecological Indicators:** Corregulates CUTI/BEAUTI outputs against local marine chlorophyll-a concentrations to estimate pelagic fish stock variability.

---

## 🛠️ Data Sources & Tech Stack

*   **Data Inputs:** ERA5 Reanalysis Wind Data, NOAA Sentinel/MODIS Sea Surface Temperature, and Copernicus Marine Service (CMEMS) Altimetry.
*   **Language:** Python 🐍 / R 📊 *(Modify based on your choice)*
*   **Libraries:** `xarray`, `pandas`, `numpy`, `matplotlib`, `cartopy`

## 🖥️ Dashboard Interface

The static dashboard in `index.html` provides a starting point for exploring a raster layer, coastal communities, time series, and underlying index records. Its current sample dataset is generated in `demo_data.js` and is **synthetic demonstration data only**; it is not sourced from Copernicus Marine and does not contain calculated CUTI/BEUTI observations. The map's raster, coordinate extent, and approximate community points are illustrative, not a real data-coverage footprint or Ghana EEZ boundary.

On desktop, the map remains fixed in the main workspace while the exploration panel scrolls independently through filters, layers, charts, and raw records. Choose CUTI or BEUTI on the map to update its synthetic raster, summary metrics, and time-series chart in the exploration panel. Selecting a drawn point or polygon hides the community filter and community list; its summary and chart show the selected area's demo sample instead. The raw table starts with five rows and can reveal more; exports include all matching records. On smaller screens the layout stacks and the page scrolls normally. Use the community and date filters to explore the sample records, or draw a point or polygon on the map to sample the illustrative raster. Point selections use the nearest demo cell; polygon selections average the demo cells inside the drawn area. The charts can be downloaded as SVG, and the filtered table can be exported as CSV or JSON. Copernicus Marine integration and verified EEZ geometry have not yet been connected to this interface.

---

## 📂 Repository Structure

```text
├── data/               # Raw and processed SST/Wind time-series data
├── src/                # Codebase for calculating CUTI and BEAUTI indexes
│   ├── processing.py   # NetCDF spatial clipping and data extraction
│   └── indices.py      # Mathematical implementations of CUTI/BEAUTI formulas
├── notebooks/          # Jupyter notebooks for visual analysis and trend plotting
├── figures/            # Generated plots, maps, and anomaly graphs
└── README.md           # Project documentation
```

---

## 📧 Contact & Contributions

Contributions, feedback, and collaboration from physical oceanographers, marine biologists, and data scientists are welcome! Please open an issue or submit a pull request. 

🔬 **Author/Researcher:** [Your Name/GitHub Handle]
🇬🇭 **Focus Region:** Gulf of Guinea (Ecosystem Sub-division 34)
