(function () {
    "use strict";

    const demo = window.GHANA_UPWELLING_DEMO;
    const siteFilter = document.getElementById("site-filter");
    const startInput = document.getElementById("start-date");
    const endInput = document.getElementById("end-date");
    const recordsBody = document.getElementById("records-body");
    const emptyState = document.getElementById("empty-state");
    const sitesByName = new Map(demo.sites.map(function (site) { return [site.name, site]; }));
    const dates = demo.records.map(function (record) { return record.date; }).sort();

    demo.sites.forEach(function (site) {
        const option = document.createElement("option");
        option.value = site.name;
        option.textContent = site.name;
        siteFilter.appendChild(option);
    });
    startInput.min = dates[0];
    startInput.max = dates[dates.length - 1];
    endInput.min = dates[0];
    endInput.max = dates[dates.length - 1];
    startInput.value = dates[0];
    endInput.value = dates[dates.length - 1];

    function selectedRecords() {
        const site = siteFilter.value;
        return demo.records.filter(function (record) {
            return (site === "all" || record.site === site) &&
                record.date >= startInput.value &&
                record.date <= endInput.value;
        }).sort(function (a, b) {
            return a.date.localeCompare(b.date) || a.site.localeCompare(b.site);
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
        const latestDate = records.reduce(function (latest, record) {
            return record.date > latest ? record.date : latest;
        }, "");
        const strongest = records.reduce(function (best, record) {
            return !best || record.cuti > best.cuti ? record : best;
        }, null);
        const metrics = [
            { label: "Mean CUTI", value: mean(records, "cuti"), unit: "demo units", detail: "Across filtered records" },
            { label: "Mean BEUTI", value: mean(records, "beuti"), unit: "demo units", detail: "Across filtered records" },
            { label: "Highest CUTI sample", value: strongest ? strongest.cuti : null, unit: strongest ? strongest.site : "", detail: strongest ? formatDate(strongest.date) : "No matching records" },
            { label: "Latest sample date", value: latestDate ? formatDate(latestDate) : "—", unit: "", detail: records.length + " records in this view" }
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
        const x = 60 + ((site.longitude + 2.5) / 2.65) * 580;
        const y = 226 - ((site.latitude - 4.55) / 1.25) * 190;
        return { x: x, y: y };
    }

    function renderMap() {
        const map = document.getElementById("site-map");
        const selectedSite = siteFilter.value;
        const horizontalLines = [48, 105, 162, 219].map(function (y) {
            return '<line class="map-grid-line" x1="60" y1="' + y + '" x2="640" y2="' + y + '"></line>';
        }).join("");
        const verticalLines = [60, 205, 350, 495, 640].map(function (x) {
            return '<line class="map-grid-line" x1="' + x + '" y1="34" x2="' + x + '" y2="226"></line>';
        }).join("");
        const markers = demo.sites.map(function (site) {
            const point = mapPoint(site);
            const selected = selectedSite === site.name;
            const labelOffset = site.name === "Accra" ? -13 : 21;
            return '<g class="map-marker" data-site="' + site.name + '">' +
                '<circle class="site-dot' + (selected ? " is-selected" : "") + '" cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="' + (selected ? 8 : 6) + '"><title>' + site.name + ' · demo location</title></circle>' +
                '<text class="site-label" x="' + (point.x + 11).toFixed(1) + '" y="' + (point.y + labelOffset).toFixed(1) + '">' + site.name + '</text></g>';
        }).join("");
        map.setAttribute("viewBox", "0 0 700 270");
        map.innerHTML = '<rect x="0" y="0" width="700" height="270" fill="#edf6f6"></rect>' +
            horizontalLines + verticalLines +
            '<text class="map-axis-label" x="60" y="250">2.5°W</text><text class="map-axis-label" x="334" y="250">1.25°W</text><text class="map-axis-label" x="612" y="250">0°</text>' +
            '<text class="map-axis-label" x="15" y="50">5.8°N</text><text class="map-axis-label" x="15" y="166">5.0°N</text><text class="map-axis-label" x="15" y="224">4.6°N</text>' +
            markers;
        map.querySelectorAll(".map-marker").forEach(function (marker) {
            marker.addEventListener("click", function () {
                siteFilter.value = marker.dataset.site;
                render();
            });
        });

        const siteList = document.getElementById("site-list");
        siteList.replaceChildren();
        const heading = document.createElement("p");
        heading.className = "site-list-label";
        heading.textContent = "Explore a site";
        siteList.appendChild(heading);
        demo.sites.forEach(function (site) {
            const button = document.createElement("button");
            button.className = "site-button";
            button.type = "button";
            button.setAttribute("aria-pressed", String(selectedSite === site.name));
            const swatch = document.createElement("span");
            swatch.className = "site-swatch";
            const label = document.createElement("span");
            label.className = "site-name";
            label.appendChild(document.createTextNode(site.name));
            const coordinates = document.createElement("span");
            coordinates.className = "site-coords";
            coordinates.textContent = site.latitude.toFixed(2) + "°N, " + Math.abs(site.longitude).toFixed(2) + "°W · approximate";
            label.appendChild(coordinates);
            button.append(swatch, label);
            button.addEventListener("click", function () {
                siteFilter.value = site.name;
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
        rows.forEach(function (record) {
            const row = document.createElement("tr");
            [formatDate(record.date), record.site, record.latitude.toFixed(2), record.longitude.toFixed(2)].forEach(function (value) {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });
            [record.cuti, record.beuti].forEach(function (value) {
                const cell = document.createElement("td");
                const pill = document.createElement("span");
                pill.className = "value-pill";
                pill.textContent = value.toFixed(3);
                cell.appendChild(pill);
                row.appendChild(cell);
            });
            recordsBody.appendChild(row);
        });
        emptyState.hidden = rows.length > 0;
        document.getElementById("filter-summary").textContent = records.length + " demo records · " +
            (records.length ? formatDate(records[0].date) + " – " + formatDate(records[records.length - 1].date) : "no matching dates");
    }

    function render() {
        const records = selectedRecords();
        renderMetrics(records);
        renderMap();
        renderChart("cuti-chart", records, "cuti", "#078c83", "CUTI demo units");
        renderChart("beuti-chart", records, "beuti", "#e47e66", "BEUTI demo units");
        renderTable(records);
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
    document.getElementById("export-csv").addEventListener("click", function () { exportRecords("csv"); });
    document.getElementById("export-json").addEventListener("click", function () { exportRecords("json"); });
    document.getElementById("reset-filters").addEventListener("click", function () {
        siteFilter.value = "all";
        startInput.value = dates[0];
        endInput.value = dates[dates.length - 1];
        render();
    });
    [siteFilter, startInput, endInput].forEach(function (input) {
        input.addEventListener("change", render);
    });

    render();
}());
