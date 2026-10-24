(function () {
    "use strict";

    const demo = window.GHANA_UPWELLING_DEMO;
    const communityOptions = document.getElementById("community-options");
    const communityPickerLabel = document.getElementById("community-picker-label");
    const startInput = document.getElementById("start-date");
    const endInput = document.getElementById("end-date");
    const recordsBody = document.getElementById("records-body");
    const emptyState = document.getElementById("empty-state");
    const dates = Array.from(new Set(demo.records.map(function (record) { return record.date; }))).sort();
    const initialRecordCount = 5;
    const defaultMapView = { x: 0, y: 0, width: 700, height: 270 };
    let mapView = { x: defaultMapView.x, y: defaultMapView.y, width: defaultMapView.width, height: defaultMapView.height };
    let selectedVariable = "cuti";
    let selection = null;
    let drawingMode = null;
    let polygonDraft = [];
    let drawingSnapshot = null;
    let visibleRecordCount = initialRecordCount;
    let selectedSites = [];

    const allCommunitiesOption = document.createElement("label");
    allCommunitiesOption.className = "community-option community-option-all";
    const allCommunitiesCheckbox = document.createElement("input");
    allCommunitiesCheckbox.type = "checkbox";
    allCommunitiesCheckbox.value = "all";
    allCommunitiesCheckbox.checked = true;
    allCommunitiesOption.append(allCommunitiesCheckbox, document.createTextNode("All communities"));
    communityOptions.appendChild(allCommunitiesOption);
    demo.sites.forEach(function (site) {
        const option = document.createElement("label");
        option.className = "community-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = site.name;
        option.append(checkbox, document.createTextNode(site.name));
        communityOptions.appendChild(option);
    });
    startInput.min = dates[0];
    startInput.max = dates[dates.length - 1];
    endInput.min = dates[0];
    endInput.max = dates[dates.length - 1];
    startInput.value = dates[0];
    endInput.value = dates[dates.length - 1];

    function selectedRecords() {
        if (selection) {
            return sampleSelection(selection).filter(function (record) {
                return record.date >= startInput.value && record.date <= endInput.value;
            });
        }
        return demo.records.filter(function (record) {
            return (!selectedSites.length || selectedSites.includes(record.site)) &&
                record.date >= startInput.value &&
                record.date <= endInput.value;
        }).sort(function (a, b) {
            return a.date.localeCompare(b.date) || a.site.localeCompare(b.site);
        });
    }

    function sampleCell(longitude, latitude, dateIndex) {
        const longitudePosition = (longitude - demo.raster.minLongitude) / (demo.raster.maxLongitude - demo.raster.minLongitude);
        const latitudePosition = (latitude - demo.raster.minLatitude) / (demo.raster.maxLatitude - demo.raster.minLatitude);
        const phase = dateIndex * 0.61 + longitudePosition * 1.8 + latitudePosition * 0.9;
        return {
            cuti: Number((0.38 + 0.23 * Math.sin(phase) + longitudePosition * 0.08).toFixed(3)),
            beuti: Number((1.7 + 0.82 * Math.cos(phase * 0.78) + latitudePosition * 0.5).toFixed(3))
        };
    }

    function pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
            const current = polygon[i];
            const previous = polygon[j];
            const crossesLatitude = (current.latitude > point.latitude) !== (previous.latitude > point.latitude);
            const intersectionLongitude = (previous.longitude - current.longitude) *
                (point.latitude - current.latitude) / (previous.latitude - current.latitude) + current.longitude;
            if (crossesLatitude && point.longitude < intersectionLongitude) inside = !inside;
        }
        return inside;
    }

    function sampleSelection(currentSelection) {
        const coordinates = currentSelection.coordinates;
        const center = coordinates.reduce(function (result, coordinate) {
            result.latitude += coordinate.latitude / coordinates.length;
            result.longitude += coordinate.longitude / coordinates.length;
            return result;
        }, { latitude: 0, longitude: 0 });
        const rasterCells = [];
        const cellWidth = (demo.raster.maxLongitude - demo.raster.minLongitude) / demo.raster.columns;
        const cellHeight = (demo.raster.maxLatitude - demo.raster.minLatitude) / demo.raster.rows;

        if (currentSelection.type === "point") {
            const column = Math.max(0, Math.min(demo.raster.columns - 1,
                Math.floor((center.longitude - demo.raster.minLongitude) / cellWidth)));
            const row = Math.max(0, Math.min(demo.raster.rows - 1,
                Math.floor((center.latitude - demo.raster.minLatitude) / cellHeight)));
            rasterCells.push({
                latitude: demo.raster.minLatitude + (row + 0.5) * cellHeight,
                longitude: demo.raster.minLongitude + (column + 0.5) * cellWidth
            });
        } else {
            for (let row = 0; row < demo.raster.rows; row += 1) {
                for (let column = 0; column < demo.raster.columns; column += 1) {
                    const cell = {
                        latitude: demo.raster.minLatitude + (row + 0.5) * cellHeight,
                        longitude: demo.raster.minLongitude + (column + 0.5) * cellWidth
                    };
                    if (pointInPolygon(cell, coordinates)) rasterCells.push(cell);
                }
            }
            if (!rasterCells.length) rasterCells.push(center);
        }

        return dates.filter(function (date) {
            return date >= startInput.value && date <= endInput.value;
        }).map(function (date) {
            const dateIndex = dates.indexOf(date);
            const values = rasterCells.map(function (cell) {
                return sampleCell(cell.longitude, cell.latitude, dateIndex);
            });
            return {
                date: date,
                site: currentSelection.name,
                latitude: Number(center.latitude.toFixed(3)),
                longitude: Number(center.longitude.toFixed(3)),
                cuti: Number((values.reduce(function (total, value) { return total + value.cuti; }, 0) / values.length).toFixed(3)),
                beuti: Number((values.reduce(function (total, value) { return total + value.beuti; }, 0) / values.length).toFixed(3))
            };
        });
    }

    function formatDate(value) {
        return new Date(value + "T00:00:00Z").toLocaleDateString("en-GB", {
            day: "2-digit", month: "short", year: "numeric", timeZone: "UTC"
        });
    }

    function mean(records, key) {
        return records.length
            ? records.reduce(function (total, record) { return total + record[key]; }, 0) / records.length
            : null;
    }

    function renderMetrics(records) {
        const variableName = selectedVariable.toUpperCase();
        const latestDate = records.reduce(function (latest, record) {
            return record.date > latest ? record.date : latest;
        }, "");
        const strongest = records.reduce(function (best, record) {
            return !best || record[selectedVariable] > best[selectedVariable] ? record : best;
        }, null);
        const metrics = [
            { label: "Mean " + variableName, value: mean(records, selectedVariable), unit: "demo units", detail: "Across filtered records" },
            { label: "Highest " + variableName + " sample", value: strongest ? strongest[selectedVariable] : null, unit: strongest ? strongest.site : "", detail: strongest ? formatDate(strongest.date) : "No matching records" },
            { label: "Latest sample date", value: latestDate ? formatDate(latestDate) : "—", unit: "", detail: records.length + " records in this view" },
            { label: "Records in view", value: records.length, unit: "", detail: selection ? selection.name : "Across selected communities" }
        ];
        const container = document.getElementById("metrics");
        container.replaceChildren();
        metrics.forEach(function (metric) {
            const card = document.createElement("article");
            card.className = "metric-card";
            const label = document.createElement("p");
            label.className = "metric-label";
            label.textContent = metric.label;
            const value = document.createElement("div");
            value.className = "metric-value";
            const mainValue = document.createElement("span");
            mainValue.textContent = typeof metric.value === "number" ? metric.value.toFixed(2) : metric.value;
            value.appendChild(mainValue);
            if (metric.unit) {
                const unit = document.createElement("small");
                unit.textContent = metric.unit;
                value.appendChild(unit);
            }
            const detail = document.createElement("p");
            detail.className = "metric-foot";
            detail.textContent = metric.detail;
            card.append(label, value, detail);
            container.appendChild(card);
        });
    }

    function mapPoint(site) {
        const x = 60 + ((site.longitude - demo.raster.minLongitude) / (demo.raster.maxLongitude - demo.raster.minLongitude)) * 580;
        const y = 226 - ((site.latitude - demo.raster.minLatitude) / (demo.raster.maxLatitude - demo.raster.minLatitude)) * 190;
        return { x: x, y: y };
    }

    function mapViewCoordinate(event) {
        const map = document.getElementById("site-map");
        const point = map.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const coordinate = point.matrixTransform(map.getScreenCTM().inverse());
        return { x: coordinate.x, y: coordinate.y };
    }

    function mapCoordinate(event) {
        const point = mapViewCoordinate(event);
        const x = point.x;
        const y = point.y;
        if (x < 60 || x > 640 || y < 34 || y > 226) return null;
        return {
            longitude: demo.raster.minLongitude + ((x - 60) / 580) * (demo.raster.maxLongitude - demo.raster.minLongitude),
            latitude: demo.raster.minLatitude + ((226 - y) / 192) * (demo.raster.maxLatitude - demo.raster.minLatitude)
        };
    }

    function rasterColor(value) {
        const colors = ["#d6eee9", "#99d5cc", "#54b5a9", "#268e88", "#176673"];
        return colors[Math.max(0, Math.min(colors.length - 1, Math.floor(value * colors.length)))];
    }

    function updateCommunityPicker() {
        allCommunitiesCheckbox.checked = selectedSites.length === 0;
        communityOptions.querySelectorAll('input[type="checkbox"][value]:not([value="all"])').forEach(function (checkbox) {
            checkbox.checked = selectedSites.includes(checkbox.value);
        });
        communityPickerLabel.textContent = selectedSites.length === 0
            ? "All communities"
            : selectedSites.length === 1
                ? selectedSites[0]
                : selectedSites.length + " communities";
    }

    function renderMap() {
        const map = document.getElementById("site-map");
        const rasterVisible = document.getElementById("raster-toggle").checked;
        const pointsVisible = document.getElementById("points-toggle").checked;
        const raster = [];
        const rasterValues = demo.records.map(function (record) { return record[selectedVariable]; });
        const rasterMinimum = Math.min.apply(null, rasterValues);
        const rasterMaximum = Math.max.apply(null, rasterValues);
        for (let row = 0; row < demo.raster.rows; row += 1) {
            for (let column = 0; column < demo.raster.columns; column += 1) {
                const cellWidth = 580 / demo.raster.columns;
                const cellHeight = 192 / demo.raster.rows;
                const longitude = demo.raster.minLongitude + (column + 0.5) / demo.raster.columns *
                    (demo.raster.maxLongitude - demo.raster.minLongitude);
                const latitude = demo.raster.maxLatitude - (row + 0.5) / demo.raster.rows *
                    (demo.raster.maxLatitude - demo.raster.minLatitude);
                const rasterSample = sampleCell(longitude, latitude, dates.length - 1)[selectedVariable];
                const value = (rasterSample - rasterMinimum) / (rasterMaximum - rasterMinimum);
                raster.push('<rect class="raster-cell" x="' + (60 + column * cellWidth).toFixed(1) + '" y="' + (34 + row * cellHeight).toFixed(1) +
                    '" width="' + cellWidth.toFixed(1) + '" height="' + cellHeight.toFixed(1) + '" fill="' + rasterColor(value) + '"></rect>');
            }
        }
        const horizontalLines = [34, 98, 162, 226].map(function (y) {
            return '<line class="map-grid-line" x1="60" y1="' + y + '" x2="640" y2="' + y + '"></line>';
        }).join("");
        const verticalLines = [60, 205, 350, 495, 640].map(function (x) {
            return '<line class="map-grid-line" x1="' + x + '" y1="34" x2="' + x + '" y2="226"></line>';
        }).join("");
        const markers = demo.sites.map(function (site) {
            const point = mapPoint(site);
            const selected = selectedSites.includes(site.name);
            const labelOffset = site.name === "Accra" || site.name === "Keta" ? -12 : 19;
            const labelAnchor = site.name === "Keta" || site.name === "Cape Three Points" ? "end" : "start";
            const labelX = labelAnchor === "end" ? point.x - 10 : point.x + 10;
            return '<g class="map-marker" data-site="' + site.name + '">' +
                '<circle class="site-dot' + (selected ? " is-selected" : "") + '" cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="' + (selected ? 8 : 6) + '"><title>' + site.name + ' · demo community</title></circle>' +
                '<text class="site-label" x="' + labelX.toFixed(1) + '" y="' + (point.y + labelOffset).toFixed(1) + '" text-anchor="' + labelAnchor + '">' + site.name + '</text></g>';
        }).join("");
        const selectedFeature = selection ? (selection.type === "point"
            ? '<circle class="selection-point" cx="' + mapPoint(selection.coordinates[0]).x.toFixed(1) + '" cy="' + mapPoint(selection.coordinates[0]).y.toFixed(1) + '" r="9"><title>Selected demo point</title></circle>'
            : '<polygon class="selection-area" points="' + selection.coordinates.map(function (coordinate) {
                const point = mapPoint(coordinate);
                return point.x.toFixed(1) + "," + point.y.toFixed(1);
            }).join(" ") + '"><title>Selected demo polygon</title></polygon>') : "";
        const draftFeature = polygonDraft.length ? '<g class="polygon-draft">' +
            (polygonDraft.length >= 3
                ? '<polygon class="selection-outline" points="' + polygonDraft.map(function (coordinate) {
                    const point = mapPoint(coordinate);
                    return point.x.toFixed(1) + "," + point.y.toFixed(1);
                }).join(" ") + '"></polygon>'
                : '<polyline class="selection-outline" points="' + polygonDraft.map(function (coordinate) {
                    const point = mapPoint(coordinate);
                    return point.x.toFixed(1) + "," + point.y.toFixed(1);
                }).join(" ") + '"></polyline>') +
            polygonDraft.map(function (coordinate) {
                const point = mapPoint(coordinate);
                return '<circle class="selection-vertex" cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="4"></circle>';
            }).join("") + '</g>' : "";
        map.setAttribute("viewBox", [mapView.x, mapView.y, mapView.width, mapView.height].join(" "));
        map.classList.toggle("map-drawing", Boolean(drawingMode));
        document.getElementById("raster-legend-title").textContent = selectedVariable.toUpperCase() + " raster · demo";
        document.getElementById("site-list").hidden = Boolean(selection);
        map.innerHTML = '<rect x="0" y="0" width="700" height="270" fill="#edf6f6"></rect>' +
            (rasterVisible ? '<g class="raster-layer" aria-label="Synthetic demo raster covering the displayed coordinate extent">' + raster.join("") + '</g>' : "") +
            '<g class="map-grid">' + horizontalLines + verticalLines + '</g>' +
            '<text class="map-axis-label" x="60" y="250">3°W</text><text class="map-axis-label" x="193" y="250">2°W</text><text class="map-axis-label" x="332" y="250">1°W</text><text class="map-axis-label" x="482" y="250">0°</text><text class="map-axis-label" x="618" y="250">1°E</text>' +
            '<text class="map-axis-label" x="15" y="39">6.0°N</text><text class="map-axis-label" x="15" y="104">5.5°N</text><text class="map-axis-label" x="15" y="169">5.0°N</text><text class="map-axis-label" x="15" y="229">4.5°N</text>' +
            (pointsVisible ? '<g class="points-layer">' + markers + '</g>' : "") +
            selectedFeature + draftFeature;
        map.querySelectorAll(".map-marker").forEach(function (marker) {
            marker.addEventListener("click", function () {
                if (drawingMode) return;
                selection = null;
                drawingSnapshot = null;
                polygonDraft = [];
                updateDrawingControls();
                selectedSites = [marker.dataset.site];
                render();
            });
        });

        const siteList = document.getElementById("site-list");
        siteList.replaceChildren();
        const heading = document.createElement("p");
        heading.className = "site-list-label";
        heading.textContent = "Explore a community";
        siteList.appendChild(heading);
        demo.sites.forEach(function (site) {
            const button = document.createElement("button");
            button.className = "site-button";
            button.type = "button";
            button.setAttribute("aria-pressed", String(selectedSites.includes(site.name)));
            const swatch = document.createElement("span");
            swatch.className = "site-swatch";
            const label = document.createElement("span");
            label.className = "site-name";
            label.appendChild(document.createTextNode(site.name));
            const coordinates = document.createElement("span");
            coordinates.className = "site-coords";
            coordinates.textContent = site.latitude.toFixed(2) + "°N, " + Math.abs(site.longitude).toFixed(2) +
                "°" + (site.longitude < 0 ? "W" : "E") + " · approximate";
            label.appendChild(coordinates);
            button.append(swatch, label);
            button.addEventListener("click", function () {
                selection = null;
                drawingSnapshot = null;
                drawingMode = null;
                polygonDraft = [];
                updateDrawingControls();
                selectedSites = [site.name];
                render();
            });
            siteList.appendChild(button);
        });
    }

    function chartRecords(records, key) {
        const grouped = new Map();
        records.forEach(function (record) {
            if (!grouped.has(record.date)) grouped.set(record.date, []);
            grouped.get(record.date).push(record[key]);
        });
        return Array.from(grouped.entries()).sort(function (a, b) {
            return a[0].localeCompare(b[0]);
        }).map(function (entry) {
            return {
                date: entry[0],
                value: entry[1].reduce(function (total, number) { return total + number; }, 0) / entry[1].length
            };
        });
    }

    function renderChart(elementId, records, key, color, label) {
        const svg = document.getElementById(elementId);
        const points = chartRecords(records, key);
        const width = 620;
        const height = 235;
        const left = 43;
        const right = 14;
        const top = 14;
        const bottom = 32;
        const plotWidth = width - left - right;
        const plotHeight = height - top - bottom;
        if (!points.length) {
            svg.setAttribute("viewBox", "0 0 " + width + " " + height);
            svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#7d8d92" font-size="12">No data for this date range</text>';
            return;
        }
        const values = points.map(function (point) { return point.value; });
        const min = Math.min(0, Math.floor(Math.min.apply(null, values) * 10) / 10);
        const max = Math.ceil(Math.max.apply(null, values) * 10) / 10 || 1;
        const range = max - min || 1;
        const coordinates = points.map(function (point, index) {
            return {
                x: points.length === 1 ? left + plotWidth / 2 : left + (index / (points.length - 1)) * plotWidth,
                y: top + ((max - point.value) / range) * plotHeight,
                date: point.date,
                value: point.value
            };
        });
        const grid = [0, 1, 2, 3].map(function (index) {
            const y = top + (plotHeight / 3) * index;
            const value = max - (range / 3) * index;
            return '<line class="chart-gridline" x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '"></line>' +
                '<text class="chart-axis-label" x="' + (left - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + value.toFixed(1) + '</text>';
        }).join("");
        const path = coordinates.map(function (point, index) {
            return (index ? "L" : "M") + point.x.toFixed(1) + "," + point.y.toFixed(1);
        }).join(" ");
        const dots = coordinates.map(function (point) {
            return '<circle class="chart-point" cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="4" fill="' + color + '"><title>' + formatDate(point.date) + ": " + point.value.toFixed(3) + " " + label + '</title></circle>';
        }).join("");
        const dateLabels = [coordinates[0], coordinates[Math.floor((coordinates.length - 1) / 2)], coordinates[coordinates.length - 1]]
            .filter(function (point, index, list) { return list.findIndex(function (item) { return item.date === point.date; }) === index; })
            .map(function (point) {
                return '<text class="chart-axis-label" x="' + point.x.toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle">' + formatDate(point.date).replace(/, \d{4}$/, "") + '</text>';
            }).join("");
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        svg.innerHTML = grid + '<path class="chart-line" d="' + path + '" stroke="' + color + '"></path>' + dots + dateLabels;
    }

    function renderTable(records) {
        recordsBody.replaceChildren();
        const rows = records.slice().sort(function (a, b) {
            return b.date.localeCompare(a.date) || a.site.localeCompare(b.site);
        });
        rows.slice(0, visibleRecordCount).forEach(function (record) {
            const row = document.createElement("tr");
            [formatDate(record.date), record.site].forEach(function (value) {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });
            const valueCell = document.createElement("td");
            const valuePill = document.createElement("span");
            valuePill.className = "value-pill";
            valuePill.textContent = record[selectedVariable].toFixed(3);
            valueCell.appendChild(valuePill);
            row.appendChild(valueCell);
            recordsBody.appendChild(row);
        });
        const variableHeading = document.getElementById("records-variable-heading");
        variableHeading.replaceChildren(selectedVariable.toUpperCase() + " ");
        const demoLabel = document.createElement("span");
        demoLabel.textContent = "(demo)";
        variableHeading.appendChild(demoLabel);
        emptyState.hidden = rows.length > 0;
        const moreButton = document.getElementById("show-more-records");
        const remainingRecords = rows.length - visibleRecordCount;
        moreButton.hidden = remainingRecords <= 0;
        moreButton.textContent = "Show 5 more (" + remainingRecords + " remaining)";
        document.getElementById("records-caption").textContent = "Showing " +
            Math.min(visibleRecordCount, rows.length) + " of " + rows.length +
            " matching records for " + selectedVariable.toUpperCase() + ". Exports include all variables.";
        const location = selection
            ? selection.name + " · "
            : selectedSites.length > 1
                ? selectedSites.length + " communities · "
                : selectedSites.length === 1
                    ? selectedSites[0] + " · "
                    : "";
        document.getElementById("filter-summary").textContent = location + records.length + " demo records · " +
            (records.length ? formatDate(records[0].date) + " – " + formatDate(records[records.length - 1].date) : "no matching dates");
    }

    function updateDrawingControls() {
        const pointButton = document.getElementById("draw-point");
        const polygonButton = document.getElementById("draw-polygon");
        const finishButton = document.getElementById("finish-polygon");
        const cancelButton = document.getElementById("cancel-drawing");
        const clearButton = document.getElementById("clear-selection");
        const instructions = document.getElementById("draw-instructions");
        pointButton.setAttribute("aria-pressed", String(drawingMode === "point"));
        polygonButton.setAttribute("aria-pressed", String(drawingMode === "polygon"));
        finishButton.hidden = drawingMode !== "polygon" || polygonDraft.length < 3;
        cancelButton.hidden = !drawingMode;
        clearButton.hidden = !selection;
        if (drawingMode === "point") {
            instructions.textContent = "Click inside the raster coverage to sample the nearest demo cell.";
        } else if (drawingMode === "polygon") {
            instructions.textContent = "Click to add polygon vertices, then finish the polygon to average covered demo cells. " +
                polygonDraft.length + " point" + (polygonDraft.length === 1 ? "" : "s") + " added.";
        } else if (selection) {
            instructions.textContent = selection.name + " selected. " + selectedVariable.toUpperCase() + " chart and metrics show its demo raster sample.";
        } else {
            instructions.textContent = "Choose a point or draw a polygon to sample the raster.";
        }
    }

    function render() {
        visibleRecordCount = initialRecordCount;
        const records = selectedRecords();
        document.getElementById("records-title").textContent = selection
            ? (selection.type === "point" ? "Point sample records" : "Polygon average records")
            : "Raw demonstration records";
        document.getElementById("map-variable").value = selectedVariable;
        updateCommunityPicker();
        document.querySelectorAll(".chart-panel").forEach(function (panel) {
            panel.hidden = panel.dataset.variable !== selectedVariable;
        });
        renderMetrics(records);
        renderMap();
        renderChart("cuti-chart", records, "cuti", "#078c83", "CUTI demo units");
        renderChart("beuti-chart", records, "beuti", "#e47e66", "BEUTI demo units");
        renderTable(records);
    }

    function zoomMap(factor, anchor) {
        const currentZoom = defaultMapView.width / mapView.width;
        const nextZoom = Math.max(1, Math.min(6, currentZoom * factor));
        if (nextZoom === 1) {
            mapView = { x: defaultMapView.x, y: defaultMapView.y, width: defaultMapView.width, height: defaultMapView.height };
            document.getElementById("site-map").setAttribute("viewBox",
                [mapView.x, mapView.y, mapView.width, mapView.height].join(" "));
            return;
        }
        const appliedFactor = nextZoom / currentZoom;
        const focus = anchor || { x: mapView.x + mapView.width / 2, y: mapView.y + mapView.height / 2 };
        const width = defaultMapView.width / nextZoom;
        const height = defaultMapView.height / nextZoom;
        mapView = {
            x: Math.max(0, Math.min(defaultMapView.width - width,
                focus.x - (focus.x - mapView.x) / appliedFactor)),
            y: Math.max(0, Math.min(defaultMapView.height - height,
                focus.y - (focus.y - mapView.y) / appliedFactor)),
            width: width,
            height: height
        };
        document.getElementById("site-map").setAttribute("viewBox",
            [mapView.x, mapView.y, mapView.width, mapView.height].join(" "));
    }

    function download(filename, content, mimeType) {
        const link = document.createElement("a");
        const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function exportRecords(format) {
        const records = selectedRecords();
        if (format === "json") {
            download("ghana-upwelling-demo.json", JSON.stringify(records, null, 2), "application/json");
            return;
        }
        const columns = ["date", "site", "latitude", "longitude", "cuti", "beuti"];
        const csv = [columns.join(",")].concat(records.map(function (record) {
            return columns.map(function (column) {
                const value = String(record[column]);
                return '"' + value.replace(/"/g, '""') + '"';
            }).join(",");
        })).join("\r\n");
        download("ghana-upwelling-demo.csv", csv, "text/csv;charset=utf-8");
    }

    document.querySelectorAll(".chart-download").forEach(function (button) {
        button.addEventListener("click", function () {
            const svg = document.getElementById(button.dataset.chart + "-chart");
            const clone = svg.cloneNode(true);
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            clone.setAttribute("width", "1240");
            clone.setAttribute("height", "470");
            download(button.dataset.chart + "-demo-chart.svg", new XMLSerializer().serializeToString(clone), "image/svg+xml;charset=utf-8");
        });
    });
    document.getElementById("map-variable").addEventListener("change", function (event) {
        selectedVariable = event.target.value;
        render();
    });
    document.getElementById("export-csv").addEventListener("click", function () { exportRecords("csv"); });
    document.getElementById("export-json").addEventListener("click", function () { exportRecords("json"); });
    document.getElementById("show-more-records").addEventListener("click", function () {
        visibleRecordCount += initialRecordCount;
        renderTable(selectedRecords());
    });
    document.getElementById("reset-filters").addEventListener("click", function () {
        selection = null;
        drawingSnapshot = null;
        drawingMode = null;
        polygonDraft = [];
        selectedSites = [];
        startInput.value = dates[0];
        endInput.value = dates[dates.length - 1];
        updateDrawingControls();
        render();
    });
    communityOptions.addEventListener("change", function (event) {
        if (event.target.type !== "checkbox") return;
        selection = null;
        drawingSnapshot = null;
        drawingMode = null;
        polygonDraft = [];
        if (event.target.value === "all") {
            selectedSites = [];
        } else if (event.target.checked) {
            selectedSites = selectedSites.concat(event.target.value);
        } else {
            selectedSites = selectedSites.filter(function (site) { return site !== event.target.value; });
        }
        updateDrawingControls();
        render();
    });
    [startInput, endInput].forEach(function (input) {
        input.addEventListener("change", render);
    });
    [document.getElementById("raster-toggle"), document.getElementById("points-toggle")].forEach(function (input) {
        input.addEventListener("change", renderMap);
    });
    document.getElementById("zoom-in").addEventListener("click", function () { zoomMap(1.4); });
    document.getElementById("zoom-out").addEventListener("click", function () { zoomMap(1 / 1.4); });
    document.getElementById("zoom-reset").addEventListener("click", function () {
        mapView = { x: defaultMapView.x, y: defaultMapView.y, width: defaultMapView.width, height: defaultMapView.height };
        document.getElementById("site-map").setAttribute("viewBox",
            [mapView.x, mapView.y, mapView.width, mapView.height].join(" "));
    });
    document.getElementById("draw-point").addEventListener("click", function () {
        drawingSnapshot = drawingSnapshot || { selection: selection, sites: selectedSites.slice() };
        selection = null;
        selectedSites = [];
        drawingMode = "point";
        polygonDraft = [];
        updateDrawingControls();
        render();
    });
    document.getElementById("draw-polygon").addEventListener("click", function () {
        drawingSnapshot = drawingSnapshot || { selection: selection, sites: selectedSites.slice() };
        selection = null;
        selectedSites = [];
        drawingMode = "polygon";
        polygonDraft = [];
        updateDrawingControls();
        render();
    });
    document.getElementById("finish-polygon").addEventListener("click", function () {
        if (drawingMode !== "polygon" || polygonDraft.length < 3) return;
        selection = {
            type: "polygon",
            coordinates: polygonDraft.slice(),
            name: "Drawn polygon"
        };
        drawingSnapshot = null;
        drawingMode = null;
        polygonDraft = [];
        updateDrawingControls();
        render();
    });
    document.getElementById("cancel-drawing").addEventListener("click", function () {
        if (drawingSnapshot) {
            selection = drawingSnapshot.selection;
            selectedSites = drawingSnapshot.sites;
        }
        drawingSnapshot = null;
        drawingMode = null;
        polygonDraft = [];
        updateDrawingControls();
        render();
    });
    document.getElementById("clear-selection").addEventListener("click", function () {
        selection = null;
        drawingSnapshot = null;
        updateDrawingControls();
        render();
    });
    document.getElementById("site-map").addEventListener("wheel", function (event) {
        if (event.target.closest(".map-variable-control, .map-zoom-control")) return;
        event.preventDefault();
        zoomMap(event.deltaY < 0 ? 1.2 : 1 / 1.2, mapViewCoordinate(event));
    }, { passive: false });
    document.getElementById("site-map").addEventListener("click", function (event) {
        if (!drawingMode) return;
        const coordinate = mapCoordinate(event);
        if (!coordinate) {
            document.getElementById("draw-instructions").textContent = "Choose a location inside the displayed raster coverage.";
            return;
        }
        if (drawingMode === "point") {
            selection = {
                type: "point",
                coordinates: [coordinate],
                name: "Drawn point"
            };
            drawingSnapshot = null;
            drawingMode = null;
            updateDrawingControls();
        } else {
            polygonDraft.push(coordinate);
            updateDrawingControls();
        }
        render();
    });

    updateDrawingControls();
    render();
}());
