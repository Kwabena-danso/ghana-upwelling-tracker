(function () {
    "use strict";

    function validateGeostrophicProduct(candidate) {
        if (!candidate || typeof candidate !== "object") {
            return { data: null, reason: "No generated Copernicus velocity product loaded." };
        }
        const cells = Array.isArray(candidate.cells)
            ? candidate.cells
            : Array.isArray(candidate.vectors) ? candidate.vectors : [];
        const vectors = candidate.vectors;
        if (!cells.length || (vectors !== undefined && !Array.isArray(vectors))) {
            return { data: null, reason: "The generated Copernicus velocity product has no usable grid cells." };
        }
        if (!cells.every(function (cell) {
            return cell && Number.isFinite(cell.latitude) && Number.isFinite(cell.longitude);
        })) {
            return { data: null, reason: "The generated Copernicus velocity product has invalid coordinates." };
        }
        if (!candidate.time_series && (!Array.isArray(vectors) || !vectors.length ||
            !cells.every(function (cell) {
                return Number.isFinite(cell.eastward) &&
                    Number.isFinite(cell.northward) &&
                    Number.isFinite(cell.speed);
            }))) {
            return { data: null, reason: "The generated Copernicus velocity product has no usable values." };
        }
        const minimumCoriolis = Number(candidate["minimum_coriolis_s-1"]);
        if (!Number.isFinite(minimumCoriolis) || minimumCoriolis < 0) {
            return { data: null, reason: "The generated Copernicus velocity product is missing its mask metadata." };
        }
        if (typeof candidate.method !== "string" ||
            candidate.method.toLowerCase().indexOf("ssh") === -1 ||
            typeof candidate.interpretation !== "string") {
            return { data: null, reason: "The generated Copernicus velocity product is missing provenance metadata." };
        }
        if (candidate.time_series) {
            const timeSeries = candidate.time_series;
            if (!Array.isArray(timeSeries.dates) || !timeSeries.dates.length ||
                (typeof timeSeries.values !== "string" &&
                    (!Array.isArray(timeSeries.chunks) || !timeSeries.chunks.length))) {
                return { data: null, reason: "The generated Copernicus time series is incomplete." };
            }
            try {
                if (typeof timeSeries.values === "string") {
                    const values = decodeGeostrophicValues(timeSeries.values);
                    if (values.length !== timeSeries.dates.length * cells.length * 3) {
                        return { data: null, reason: "The generated Copernicus time series does not match its grid." };
                    }
                }
            } catch (error) {
                return { data: null, reason: "The generated Copernicus time series could not be decoded." };
            }
        }
        return { data: candidate, reason: "Copernicus velocity product ready." };
    }

    const demo = window.GHANA_UPWELLING_DEMO;
    const geostrophicProduct = validateGeostrophicProduct(window.GHANA_GEOSTROPHIC_VELOCITY);
    const geostrophicData = geostrophicProduct.data;
    const geostrophicLoadStatus = geostrophicProduct.reason;
    const communityOptions = document.getElementById("community-options");
    const communityPickerLabel = document.getElementById("community-picker-label");
    const startInput = document.getElementById("start-date");
    const endInput = document.getElementById("end-date");
    const recordsBody = document.getElementById("records-body");
    const emptyState = document.getElementById("empty-state");
    const demoDates = Array.from(new Set(demo.records.map(function (record) { return record.date; }))).sort();
    const geostrophicCells = geostrophicData
        ? geostrophicData.cells || geostrophicData.vectors
        : [];
    const geostrophicTimeSeries = geostrophicData && geostrophicData.time_series || null;
    const geostrophicDates = geostrophicTimeSeries
        ? geostrophicTimeSeries.dates
        : geostrophicData ? [geostrophicData.date] : [];
    let geostrophicValues = geostrophicTimeSeries && typeof geostrophicTimeSeries.values === "string"
        ? decodeGeostrophicValues(geostrophicTimeSeries.values)
        : null;
    const geostrophicChunkValues = new Map();
    const geostrophicChunkLoads = new Map();
    let currentGeostrophicDate = geostrophicData ? geostrophicData.date : null;
    let currentGeostrophicFrameKey = "";
    let geostrophicRecords = makeGeostrophicRecords(currentGeostrophicDate, geostrophicDates.length
        ? [geostrophicDates.length - 1]
        : []);
    let geostrophicRecordByCoordinate = new Map(geostrophicRecords.map(function (record) {
        return [record.latitude + "|" + record.longitude, record];
    }));
    const geostrophicLatitudes = Array.from(new Set(geostrophicCells.map(function (record) {
        return record.latitude;
    }))).sort(function (first, second) { return first - second; });
    const geostrophicLongitudes = Array.from(new Set(geostrophicCells.map(function (record) {
        return record.longitude;
    }))).sort(function (first, second) { return first - second; });
    const geostrophicVariableLabels = {
        speed: "Geostrophic speed",
        eastward: "Eastward velocity",
        northward: "Northward velocity"
    };
    const geostrophicVariableUnits = {
        speed: "m s⁻¹",
        eastward: "m s⁻¹",
        northward: "m s⁻¹"
    };
    const isGeostrophicVariable = function (variable) {
        return Object.prototype.hasOwnProperty.call(geostrophicVariableLabels, variable);
    };
    const geostrophicVariableIndices = { eastward: 0, northward: 1, speed: 2 };
    const initialRecordCount = 5;
    const mapPlot = { left: 60, right: 640, top: 35, bottom: 465 };
    const defaultMapView = { x: 0, y: 0, width: 700, height: 500 };
    let mapView = { x: defaultMapView.x, y: defaultMapView.y, width: defaultMapView.width, height: defaultMapView.height };
    let selectedVariable = geostrophicRecords.length && window.L ? "speed" : "cuti";
    let selection = null;
    let selectedGeostrophicRecord = null;
    let drawingMode = null;
    let polygonDraft = [];
    let drawingSnapshot = null;
    let visibleRecordCount = initialRecordCount;
    let selectedSites = [];
    let geostrophicLeafletMap = null;
    let geostrophicCurrentLayer = null;
    let geostrophicCommunityLayer = null;
    let geostrophicSelectionLayer = null;
    let geostrophicRasterLayer = null;
    let geostrophicLegendControl = null;
    let geostrophicMapHasFitBounds = false;
    let geostrophicRasterMinimum = 0;
    let geostrophicRasterMaximum = 1;
    let geostrophicRasterPalette = [];

    function decodeGeostrophicValues(encoded) {
        const binary = window.atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return new Float32Array(bytes.buffer);
    }

    function loadGeostrophicChunk(chunkIndex) {
        if (geostrophicValues || geostrophicChunkValues.has(chunkIndex)) {
            return Promise.resolve();
        }
        if (geostrophicChunkLoads.has(chunkIndex)) return geostrophicChunkLoads.get(chunkIndex);
        const descriptor = geostrophicTimeSeries.chunks[chunkIndex];
        const promise = new Promise(function (resolve, reject) {
            const script = document.createElement("script");
            script.src = new URL("data/processed/" + descriptor.file, document.baseURI).href;
            script.onload = function () {
                const encoded = window.GHANA_GEOSTROPHIC_CHUNKS &&
                    window.GHANA_GEOSTROPHIC_CHUNKS[chunkIndex];
                if (typeof encoded !== "string") {
                    reject(new Error("Missing Copernicus frame chunk " + chunkIndex));
                    return;
                }
                geostrophicChunkValues.set(chunkIndex, decodeGeostrophicValues(encoded));
                resolve();
            };
            script.onerror = function () {
                reject(new Error("Could not load Copernicus frame chunk " + chunkIndex));
            };
            document.head.appendChild(script);
        });
        geostrophicChunkLoads.set(chunkIndex, promise);
        return promise;
    }

    function loadGeostrophicFrames(frameIndices) {
        if (geostrophicValues || !geostrophicTimeSeries.chunks) return Promise.resolve();
        const chunkSize = geostrophicTimeSeries.chunk_size;
        const chunkIndices = Array.from(new Set(frameIndices.map(function (frameIndex) {
            return Math.floor(frameIndex / chunkSize);
        })));
        return Promise.all(chunkIndices.map(loadGeostrophicChunk));
    }

    function geostrophicValueAt(frameIndex, cellIndex, componentIndex) {
        if (geostrophicValues) {
            return geostrophicValues[(frameIndex * geostrophicCells.length + cellIndex) * 3 + componentIndex];
        }
        const chunkSize = geostrophicTimeSeries.chunk_size;
        const chunkIndex = Math.floor(frameIndex / chunkSize);
        const chunkValues = geostrophicChunkValues.get(chunkIndex);
        if (!chunkValues) return null;
        const frameOffset = (frameIndex % chunkSize) * geostrophicCells.length * 3;
        return chunkValues[frameOffset + cellIndex * 3 + componentIndex];
    }

    function makeGeostrophicRecords(date, frameIndices) {
        if (!geostrophicData) return [];
        const cellCount = geostrophicCells.length;
        return geostrophicCells.map(function (cell, index) {
            let eastward = cell.eastward;
            let northward = cell.northward;
            let speed = cell.speed;
            if (geostrophicValues && frameIndices && frameIndices.length) {
                let eastwardTotal = 0;
                let northwardTotal = 0;
                let speedTotal = 0;
                let sampleCount = 0;
                frameIndices.forEach(function (frameIndex) {
                    const frameEastward = geostrophicValueAt(frameIndex, index, 0);
                    const frameNorthward = geostrophicValueAt(frameIndex, index, 1);
                    const frameSpeed = geostrophicValueAt(frameIndex, index, 2);
                    if (![frameEastward, frameNorthward, frameSpeed].every(Number.isFinite)) return;
                    eastwardTotal += frameEastward;
                    northwardTotal += frameNorthward;
                    speedTotal += frameSpeed;
                    sampleCount += 1;
                });
                if (sampleCount) {
                    eastward = eastwardTotal / sampleCount;
                    northward = northwardTotal / sampleCount;
                    speed = speedTotal / sampleCount;
                }
            }
            if (![eastward, northward, speed].every(Number.isFinite)) return null;
            return {
                id: index,
                date: date,
                site: "Grid cell " + (index + 1) + " · " +
                    Math.abs(cell.latitude).toFixed(3) + "°" + (cell.latitude < 0 ? "S" : "N") +
                    ", " + Math.abs(cell.longitude).toFixed(3) + "°" +
                    (cell.longitude < 0 ? "W" : "E"),
                latitude: cell.latitude,
                longitude: cell.longitude,
                bounds: cell.bounds,
                row: cell.row,
                column: cell.column,
                eastward: eastward,
                northward: northward,
                speed: speed
            };
        }).filter(Boolean);
    }

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
    function configureDateFilters() {
        const currentDates = isGeostrophicVariable(selectedVariable)
            ? geostrophicDates.filter(Boolean)
            : demoDates;
        startInput.min = currentDates[0];
        startInput.max = currentDates[currentDates.length - 1];
        endInput.min = currentDates[0];
        endInput.max = currentDates[currentDates.length - 1];
        if (isGeostrophicVariable(selectedVariable)) {
            startInput.value = currentDates[currentDates.length - 1];
            endInput.value = currentDates[currentDates.length - 1];
        } else {
            startInput.value = currentDates[0];
            endInput.value = currentDates[currentDates.length - 1];
        }
    }

    function updateGeostrophicFrame() {
        if (!isGeostrophicVariable(selectedVariable) || !geostrophicDates.length) return;
        const matchingFrameIndices = geostrophicDates.map(function (date, index) {
            return date && date >= startInput.value && date <= endInput.value ? index : -1;
        }).filter(function (index) {
            return index >= 0;
        });
        const fallbackIndex = geostrophicDates.reduce(function (closestIndex, date, index) {
            return date && date <= endInput.value ? index : closestIndex;
        }, 0);
        const frameIndices = matchingFrameIndices.length ? matchingFrameIndices : [fallbackIndex];
        const date = geostrophicDates[frameIndices[frameIndices.length - 1]];
        const frameKey = frameIndices.join(",");
        if (date === currentGeostrophicDate && frameKey === currentGeostrophicFrameKey) return;

        const selectedId = selectedGeostrophicRecord ? selectedGeostrophicRecord.id : null;
        currentGeostrophicDate = date;
        currentGeostrophicFrameKey = frameKey;
        geostrophicRecords = makeGeostrophicRecords(date, frameIndices);
        geostrophicRecordByCoordinate = new Map(geostrophicRecords.map(function (record) {
            return [record.latitude + "|" + record.longitude, record];
        }));
        selectedGeostrophicRecord = selectedId === null
            ? null
            : geostrophicRecords.find(function (record) { return record.id === selectedId; }) || null;
        loadGeostrophicFrames(frameIndices).then(function () {
            if (currentGeostrophicFrameKey !== frameKey) return;
            geostrophicRecords = makeGeostrophicRecords(date, frameIndices);
            geostrophicRecordByCoordinate = new Map(geostrophicRecords.map(function (record) {
                return [record.latitude + "|" + record.longitude, record];
            }));
            render();
        }).catch(function (error) {
            console.error(error);
            document.getElementById("geostrophic-status").textContent =
                "Copernicus frame loading failed: " + error.message;
        });
    }

    configureDateFilters();
    updateGeostrophicFrame();
    const geostrophicMapEnabled = isGeostrophicVariable(selectedVariable) && Boolean(window.L);
    document.getElementById("geostrophic-toggle").checked = geostrophicMapEnabled;
    if (geostrophicMapEnabled) document.getElementById("raster-toggle").checked = true;
    ["speed", "eastward", "northward"].forEach(function (variable) {
        const option = document.querySelector('#map-variable option[value="' + variable + '"]');
        option.disabled = !geostrophicRecords.length || !window.L;
    });

    function selectedRecords() {
        if (isGeostrophicVariable(selectedVariable)) {
            return selectedGeostrophicRecords();
        }
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

        return demoDates.filter(function (date) {
            return date >= startInput.value && date <= endInput.value;
        }).map(function (date) {
            const dateIndex = demoDates.indexOf(date);
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

    function nearestGeostrophicRecord(coordinate) {
        const nearest = geostrophicRecords.reduce(function (closest, record) {
            const latitudeScale = Math.cos(coordinate.latitude * Math.PI / 180);
            const distance = Math.pow(record.latitude - coordinate.latitude, 2) +
                Math.pow((record.longitude - coordinate.longitude) * latitudeScale, 2);
            return !closest || distance < closest.distance
                ? { record: record, distance: distance }
                : closest;
        }, null);
        return nearest ? nearest.record : null;
    }

    function isWithinGeostrophicCoverage(coordinate) {
        return geostrophicRecords.some(function (record) {
            const bounds = geostrophicBounds(record);
            return coordinate.latitude >= bounds[0] && coordinate.latitude <= bounds[2] &&
                coordinate.longitude >= bounds[1] && coordinate.longitude <= bounds[3];
        });
    }

    function selectedGeostrophicRecords() {
        if (selectedGeostrophicRecord) return [selectedGeostrophicRecord];
        if (selection) {
            if (selection.type === "point") {
                const record = nearestGeostrophicRecord(selection.coordinates[0]);
                return record ? [record] : [];
            }
            return geostrophicRecords.filter(function (record) {
                return pointInPolygon(record, selection.coordinates);
            });
        }
        if (selectedSites.length) {
            const selectedIds = new Set(selectedSites.map(function (siteName) {
                const site = demo.sites.find(function (item) { return item.name === siteName; });
                const nearest = site && nearestGeostrophicRecord(site);
                return nearest ? nearest.id : null;
            }).filter(function (id) { return id !== null; }));
            return geostrophicRecords.filter(function (record) { return selectedIds.has(record.id); });
        }
        return geostrophicRecords;
    }

    function geostrophicChartRecords() {
        if (!geostrophicTimeSeries) return chartRecords(selectedRecords(), selectedVariable);
        const variableIndex = geostrophicVariableIndices[selectedVariable];
        const selectedIds = new Set(selectedGeostrophicRecords().map(function (record) { return record.id; }));
        const dates = geostrophicDates.filter(function (date) {
            return date && date >= startInput.value && date <= endInput.value;
        });
        return dates.map(function (date) {
            const frameIndex = geostrophicDates.indexOf(date);
            let total = 0;
            let count = 0;
            for (let cellIndex = 0; cellIndex < geostrophicCells.length; cellIndex += 1) {
                if (!selectedIds.has(cellIndex)) continue;
                const value = geostrophicValueAt(frameIndex, cellIndex, variableIndex);
                if (!Number.isFinite(value)) continue;
                total += value;
                count += 1;
            }
            return count ? { date: date, [selectedVariable]: total / count } : null;
        }).filter(Boolean);
    }

    function renderMetrics(records) {
        const geostrophic = isGeostrophicVariable(selectedVariable);
        const variableName = geostrophic
            ? geostrophicVariableLabels[selectedVariable]
            : selectedVariable.toUpperCase();
        const latestDate = records.reduce(function (latest, record) {
            return record.date > latest ? record.date : latest;
        }, "");
        const strongest = records.reduce(function (best, record) {
            return !best || record[selectedVariable] > best[selectedVariable] ? record : best;
        }, null);
        const metrics = [
            { label: "Mean " + variableName, value: mean(records, selectedVariable), unit: geostrophic ? geostrophicVariableUnits[selectedVariable] : "demo units", detail: geostrophic ? "Across selected grid cells" : "Across filtered records" },
            { label: "Highest " + variableName + " sample", value: strongest ? strongest[selectedVariable] : null, unit: strongest ? strongest.site : "", detail: strongest ? formatDate(strongest.date) : "No matching records" },
            { label: "Latest sample date", value: latestDate ? formatDate(latestDate) : "—", unit: "", detail: records.length + " records in this view" },
            { label: geostrophic ? "Grid cells in view" : "Records in view", value: records.length, unit: "", detail: selectedGeostrophicRecord ? selectedGeostrophicRecord.site : selection ? selection.name : geostrophic ? "Map mean: " + formatDate(startInput.value) + " – " + formatDate(endInput.value) : "Across selected communities" }
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
            mainValue.textContent = typeof metric.value === "number"
                ? metric.label === "Records in view" || metric.label === "Grid cells in view"
                    ? metric.value.toLocaleString("en-US")
                    : metric.value.toFixed(2)
                : metric.value;
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
        const x = mapPlot.left + ((site.longitude - demo.raster.minLongitude) / (demo.raster.maxLongitude - demo.raster.minLongitude)) * (mapPlot.right - mapPlot.left);
        const y = mapPlot.bottom - ((site.latitude - demo.raster.minLatitude) / (demo.raster.maxLatitude - demo.raster.minLatitude)) * (mapPlot.bottom - mapPlot.top);
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
        if (x < mapPlot.left || x > mapPlot.right || y < mapPlot.top || y > mapPlot.bottom) return null;
        return {
            longitude: demo.raster.minLongitude + ((x - mapPlot.left) / (mapPlot.right - mapPlot.left)) * (demo.raster.maxLongitude - demo.raster.minLongitude),
            latitude: demo.raster.minLatitude + ((mapPlot.bottom - y) / (mapPlot.bottom - mapPlot.top)) * (demo.raster.maxLatitude - demo.raster.minLatitude)
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

    function renderCommunityList(isGeostrophic) {
        const siteList = document.getElementById("site-list");
        siteList.replaceChildren();
        const heading = document.createElement("p");
        heading.className = "site-list-label";
        heading.textContent = isGeostrophic ? "Approximate community locations" : "Explore a community";
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
                "°" + (site.longitude < 0 ? "W" : "E") + " · approximate" +
                (isGeostrophic ? " · nearest Copernicus cell" : "");
            label.appendChild(coordinates);
            button.append(swatch, label);
            button.addEventListener("click", function () {
                selection = null;
                selectedGeostrophicRecord = null;
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

    function colorToRgb(color) {
        return [
            parseInt(color.slice(1, 3), 16),
            parseInt(color.slice(3, 5), 16),
            parseInt(color.slice(5, 7), 16)
        ];
    }

    function geostrophicColor(value) {
        const fraction = geostrophicRasterMaximum > geostrophicRasterMinimum
            ? Math.max(0, Math.min(1,
                (value - geostrophicRasterMinimum) /
                (geostrophicRasterMaximum - geostrophicRasterMinimum)))
            : 0.5;
        const position = fraction * (geostrophicRasterPalette.length - 1);
        const lowerIndex = Math.floor(position);
        const upperIndex = Math.min(geostrophicRasterPalette.length - 1, lowerIndex + 1);
        const blend = position - lowerIndex;
        const rgb = geostrophicRasterPalette[lowerIndex].map(function (component, index) {
            return Math.round(component + (geostrophicRasterPalette[upperIndex][index] - component) * blend);
        });
        return rgb;
    }

    function geostrophicBounds(record) {
        if (record.bounds) return record.bounds;
        const latitudeSpacing = geostrophicLatitudes.length > 1
            ? geostrophicLatitudes[1] - geostrophicLatitudes[0]
            : 0;
        const longitudeSpacing = geostrophicLongitudes.length > 1
            ? geostrophicLongitudes[1] - geostrophicLongitudes[0]
            : 0;
        return [
            record.latitude - latitudeSpacing / 2,
            record.longitude - longitudeSpacing / 2,
            record.latitude + latitudeSpacing / 2,
            record.longitude + longitudeSpacing / 2
        ];
    }

    function coordinateBracket(coordinates, value) {
        if (coordinates.length < 2 || value < coordinates[0] || value > coordinates[coordinates.length - 1]) {
            return null;
        }
        let lower = 0;
        let upper = coordinates.length - 1;
        while (upper - lower > 1) {
            const middle = Math.floor((lower + upper) / 2);
            if (coordinates[middle] <= value) lower = middle;
            else upper = middle;
        }
        const fraction = (value - coordinates[lower]) / (coordinates[upper] - coordinates[lower]);
        return { lower: lower, upper: upper, fraction: fraction };
    }

    function sampleGeostrophicRasterValue(latitude, longitude) {
        const latitudeBracket = coordinateBracket(geostrophicLatitudes, latitude);
        const longitudeBracket = coordinateBracket(geostrophicLongitudes, longitude);
        if (!latitudeBracket || !longitudeBracket) return null;

        const lowerLeft = geostrophicRecordByCoordinate.get(
            geostrophicLatitudes[latitudeBracket.lower] + "|" +
            geostrophicLongitudes[longitudeBracket.lower]
        );
        const lowerRight = geostrophicRecordByCoordinate.get(
            geostrophicLatitudes[latitudeBracket.lower] + "|" +
            geostrophicLongitudes[longitudeBracket.upper]
        );
        const upperLeft = geostrophicRecordByCoordinate.get(
            geostrophicLatitudes[latitudeBracket.upper] + "|" +
            geostrophicLongitudes[longitudeBracket.lower]
        );
        const upperRight = geostrophicRecordByCoordinate.get(
            geostrophicLatitudes[latitudeBracket.upper] + "|" +
            geostrophicLongitudes[longitudeBracket.upper]
        );
        const x = longitudeBracket.fraction;
        const y = latitudeBracket.fraction;
        const samples = [
            { record: lowerLeft, weight: (1 - x) * (1 - y) },
            { record: lowerRight, weight: x * (1 - y) },
            { record: upperLeft, weight: (1 - x) * y },
            { record: upperRight, weight: x * y }
        ];
        let value = 0;
        let coverage = 0;
        samples.forEach(function (sample) {
            if (!sample.record || !Number.isFinite(sample.record[selectedVariable])) return;
            value += sample.record[selectedVariable] * sample.weight;
            coverage += sample.weight;
        });
        return coverage > 0 ? { value: value / coverage, coverage: coverage } : null;
    }

    function sampleGeostrophicVector(latitude, longitude) {
        const latitudeBracket = coordinateBracket(geostrophicLatitudes, latitude);
        const longitudeBracket = coordinateBracket(geostrophicLongitudes, longitude);
        if (!latitudeBracket || !longitudeBracket) return null;
        const x = longitudeBracket.fraction;
        const y = latitudeBracket.fraction;
        const samples = [
            { record: geostrophicRecordByCoordinate.get(geostrophicLatitudes[latitudeBracket.lower] + "|" + geostrophicLongitudes[longitudeBracket.lower]), weight: (1 - x) * (1 - y) },
            { record: geostrophicRecordByCoordinate.get(geostrophicLatitudes[latitudeBracket.lower] + "|" + geostrophicLongitudes[longitudeBracket.upper]), weight: x * (1 - y) },
            { record: geostrophicRecordByCoordinate.get(geostrophicLatitudes[latitudeBracket.upper] + "|" + geostrophicLongitudes[longitudeBracket.lower]), weight: (1 - x) * y },
            { record: geostrophicRecordByCoordinate.get(geostrophicLatitudes[latitudeBracket.upper] + "|" + geostrophicLongitudes[longitudeBracket.upper]), weight: x * y }
        ];
        let eastward = 0;
        let northward = 0;
        let coverage = 0;
        samples.forEach(function (sample) {
            if (!sample.record || !Number.isFinite(sample.record.eastward) || !Number.isFinite(sample.record.northward)) return;
            eastward += sample.record.eastward * sample.weight;
            northward += sample.record.northward * sample.weight;
            coverage += sample.weight;
        });
        return coverage > 0 ? {
            eastward: eastward / coverage,
            northward: northward / coverage
        } : null;
    }

    function createGeostrophicRasterTile(coordinates, done) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;
        const context = tile.getContext("2d");
        const image = context.createImageData(size.x, size.y);
        for (let y = 0; y < size.y; y += 1) {
            for (let x = 0; x < size.x; x += 1) {
                const point = new window.L.Point(
                    coordinates.x * size.x + x + 0.5,
                    coordinates.y * size.y + y + 0.5
                );
                const coordinate = geostrophicLeafletMap.unproject(point, coordinates.z);
                const value = sampleGeostrophicRasterValue(coordinate.lat, coordinate.lng);
                if (value === null) continue;
                const color = geostrophicColor(value.value);
                const offset = (y * size.x + x) * 4;
                image.data[offset] = color[0];
                image.data[offset + 1] = color[1];
                image.data[offset + 2] = color[2];
                image.data[offset + 3] = Math.round(220 * value.coverage);
            }
        }
        context.putImageData(image, 0, 0);
        window.L.DomUtil.addClass(tile, "leaflet-tile-loaded");
        done(null, tile);
        return tile;
    }

    function initializeGeostrophicLeaflet() {
        if (!window.L) return false;
        if (geostrophicLeafletMap) return true;

        geostrophicLeafletMap = window.L.map("geostrophic-leaflet", {
            scrollWheelZoom: true,
            zoomControl: true,
            preferCanvas: true
        });
        geostrophicLeafletMap.on("click", function (event) {
            const coordinate = { latitude: event.latlng.lat, longitude: event.latlng.lng };
            if (!isWithinGeostrophicCoverage(coordinate)) {
                if (drawingMode) {
                    document.getElementById("draw-instructions").textContent =
                        "Choose a location inside the Copernicus grid coverage.";
                }
                return;
            }
            if (drawingMode === "point") {
                const record = nearestGeostrophicRecord(coordinate);
                if (!record) return;
                selection = {
                    type: "point",
                    coordinates: [coordinate],
                    name: "Point near " + record.site
                };
                drawingMode = null;
                drawingSnapshot = null;
                updateDrawingControls();
                render();
                return;
            }
            if (drawingMode === "polygon") {
                polygonDraft.push(coordinate);
                updateDrawingControls();
                renderGeostrophicSelection();
                return;
            }
            const record = nearestGeostrophicRecord(coordinate);
            if (record) selectGeostrophicRecord(record);
        });
        window.L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
            {
                maxZoom: 19,
                attribution: "Tiles &copy; Esri — Sources: Esri, TomTom, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors, and the GIS User Community"
            }
        ).addTo(geostrophicLeafletMap);
        const rasterPane = geostrophicLeafletMap.createPane("geostrophicRasterPane");
        rasterPane.style.zIndex = 350;
        rasterPane.style.pointerEvents = "none";
        geostrophicRasterLayer = window.L.gridLayer({
            tileSize: 256,
            noWrap: true,
            pane: "geostrophicRasterPane",
            updateWhenIdle: true,
            keepBuffer: 1
        });
        geostrophicRasterLayer.createTile = createGeostrophicRasterTile;
        geostrophicRasterLayer.addTo(geostrophicLeafletMap);
        geostrophicCurrentLayer = window.L.layerGroup().addTo(geostrophicLeafletMap);
        geostrophicCommunityLayer = window.L.layerGroup().addTo(geostrophicLeafletMap);
        geostrophicSelectionLayer = window.L.layerGroup().addTo(geostrophicLeafletMap);
        geostrophicLegendControl = window.L.control({ position: "bottomright" });
        geostrophicLegendControl.onAdd = function () {
            const legend = window.L.DomUtil.create("div", "leaflet-current-legend");
            legend.innerHTML = "";
            return legend;
        };
        geostrophicLegendControl.addTo(geostrophicLeafletMap);
        return true;
    }

    function renderGeostrophicLeaflet() {
        if (!initializeGeostrophicLeaflet()) return false;

        const mapFrame = document.querySelector(".map-frame");
        const communityPointsToggle = document.getElementById("points-toggle");
        mapFrame.classList.add("is-geostrophic");
        document.getElementById("draw-tools").hidden = false;
        document.getElementById("draw-tools").querySelector(".site-list-label").textContent = "Select an area on the map";
        document.getElementById("draw-buttons").hidden = false;
        document.getElementById("site-list").hidden = false;
        document.getElementById("community-filter").hidden = false;
        document.getElementById("draw-instructions").textContent = "";
        updateDrawingControls();
        document.getElementById("raster-toggle").closest("label").hidden = false;
        document.getElementById("raster-toggle").closest("label").querySelector("span").textContent = "(Copernicus)";
        document.getElementById("raster-legend").hidden = true;
        document.getElementById("map-variable").disabled = false;

        geostrophicCurrentLayer.clearLayers();
        geostrophicCommunityLayer.clearLayers();
        renderGeostrophicSelection();
        const values = geostrophicRecords.map(function (record) {
            return record[selectedVariable];
        }).sort(function (first, second) {
            return first - second;
        });
        const absoluteValues = values.map(Math.abs).sort(function (first, second) {
            return first - second;
        });
        const scalarExtent = selectedVariable !== "speed" && absoluteValues.length
            ? absoluteValues[absoluteValues.length - 1]
            : 0;
        const scalarMinimum = selectedVariable === "speed" ? 0 : -scalarExtent;
        const scalarMaximum = selectedVariable === "speed"
            ? values[values.length - 1]
            : scalarExtent;
        const maximumSpeed = values.length ? scalarMaximum : 1;
        const rasterVisible = document.getElementById("raster-toggle").checked;
        geostrophicRasterMinimum = scalarMinimum;
        geostrophicRasterMaximum = maximumSpeed;
        geostrophicRasterPalette = (selectedVariable === "speed"
            ? ["#fff7bc", "#fec44f", "#fe9929", "#ec7014", "#cc4c02"]
            : ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"]
        ).map(colorToRgb);
        geostrophicRasterLayer.setOpacity(rasterVisible ? 1 : 0);
        geostrophicRasterLayer.redraw();

        if (selectedVariable === "speed") {
            const arrowStride = geostrophicTimeSeries
                ? Math.min(3, geostrophicData.arrow_stride || 3)
                : geostrophicData.arrow_stride || 8;
            const arrowRecords = geostrophicTimeSeries
                ? geostrophicRecords.filter(function (record) {
                    return record.row % arrowStride === 0 && record.column % arrowStride === 0;
                })
                : geostrophicData.vectors.map(function (vector) {
                    return geostrophicRecordByCoordinate.get(vector.latitude + "|" + vector.longitude);
                }).filter(Boolean);
            const maximumArrowSpeed = Math.max.apply(null, geostrophicRecords.map(function (record) {
                return record.speed;
            })) || 1;
            arrowRecords.forEach(function (record) {
                const direction = Math.atan2(record.eastward, record.northward) * 180 / Math.PI;
                const arrowLength = 24 * record.speed / maximumArrowSpeed;
                const icon = window.L.divIcon({
                    className: "leaflet-current-icon",
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                    html: '<span class="leaflet-current-arrow" style="--arrow-direction:' +
                        direction.toFixed(1) + 'deg;--arrow-length:' + arrowLength.toFixed(1) + 'px">' +
                        '<svg viewBox="0 0 12 24" aria-hidden="true">' +
                        '<path class="leaflet-arrow-halo" d="M6 23V2M3 5l3-3 3 3"></path>' +
                        '<path class="leaflet-arrow-shaft" d="M6 23V2M3 5l3-3 3 3"></path>' +
                        '</svg></span>'
                });
                const marker = window.L.marker([record.latitude, record.longitude], {
                    icon: icon,
                    keyboard: true,
                    interactive: !drawingMode,
                    title: geostrophicVariableLabels[selectedVariable] + " · " +
                        record[selectedVariable].toFixed(3) + " m/s"
                });
                marker.on("click", function () {
                    selectGeostrophicRecord(record);
                });
                marker.bindPopup(
                    '<div class="leaflet-current-popup"><strong>Surface geostrophic current</strong><br>' +
                    "Date range mean: " + startInput.value + " – " + endInput.value + "<br>" +
                    "Speed: " + record.speed.toFixed(3) + " m s⁻¹<br>" +
                    "Eastward: " + record.eastward.toFixed(3) + " m s⁻¹<br>" +
                    "Northward: " + record.northward.toFixed(3) + " m s⁻¹<br>" +
                    "Position: " + record.latitude.toFixed(3) + "°N, " +
                    record.longitude.toFixed(3) + "°</div>"
                );
                marker.addTo(geostrophicCurrentLayer);
            });
        }

        if (communityPointsToggle.checked) {
            demo.sites.forEach(function (site) {
                const marker = window.L.circleMarker([site.latitude, site.longitude], {
                    radius: 5,
                    color: selectedSites.includes(site.name) ? "#075985" : "#684400",
                    weight: 1,
                    fillColor: selectedSites.includes(site.name) ? "#38bdf8" : "#f39200",
                    fillOpacity: 1,
                    interactive: !drawingMode,
                    title: site.name
                });
                marker.on("click", function () {
                    selection = null;
                    selectedGeostrophicRecord = null;
                    drawingMode = null;
                    polygonDraft = [];
                    drawingSnapshot = null;
                    selectedSites = [site.name];
                    updateDrawingControls();
                    render();
                });
                marker.bindPopup(
                    "<strong>" + site.name + "</strong><br>Approximate demonstration location; values use the nearest Copernicus grid cell."
                );
                marker.addTo(geostrophicCommunityLayer);
            });
        }
        renderCommunityList(true);

        geostrophicLeafletMap.invalidateSize({ pan: false });
        if (!geostrophicMapHasFitBounds) {
            const validLatitudes = geostrophicRecords.map(function (record) { return record.latitude; });
            const validLongitudes = geostrophicRecords.map(function (record) { return record.longitude; });
            geostrophicLeafletMap.fitBounds(
                [
                    [Math.min.apply(null, validLatitudes), Math.min.apply(null, validLongitudes)],
                    [Math.max.apply(null, validLatitudes), Math.max.apply(null, validLongitudes)]
                ],
                { padding: [24, 24], maxZoom: 7 }
            );
            geostrophicMapHasFitBounds = true;
        }
        const legend = geostrophicLegendControl.getContainer();
        if (legend) {
            const minimumLabel = selectedVariable === "speed" ? "0" : scalarMinimum.toFixed(3);
            const maximumLabel = selectedVariable === "speed" ? maximumSpeed.toFixed(3) : scalarMaximum.toFixed(3);
            legend.innerHTML =
                "<strong>" + geostrophicVariableLabels[selectedVariable] + " · m s⁻¹</strong>" +
                '<div class="leaflet-speed-gradient" aria-hidden="true"></div>' +
                '<div class="leaflet-speed-labels"><span>' + minimumLabel + '</span><span>' + maximumLabel + '</span></div>' +
                "<div>" + (selectedVariable === "speed"
                    ? "Arrows show current direction"
                    : "Color shows the selected velocity component") + "</div>";
            legend.querySelector(".leaflet-speed-gradient").style.background = selectedVariable === "speed"
                ? "linear-gradient(90deg, #fff7bc, #fec44f, #fe9929, #ec7014, #cc4c02)"
                : "linear-gradient(90deg, #313695, #74add1, #ffffbf, #f46d43, #a50026)";
        }
        const sourceTimeSteps = Number(geostrophicData.source_time_steps);
        const publishedTimeSteps = Number(geostrophicData.published_time_steps);
        const timeCoverage = Number.isFinite(sourceTimeSteps) && Number.isFinite(publishedTimeSteps)
            ? " · " + publishedTimeSteps + "/" + sourceTimeSteps + " source dates published"
            : "";
        document.getElementById("geostrophic-status").textContent =
            "Copernicus mean " + startInput.value + " – " + endInput.value + " · " + geostrophicRecords.length +
            " grid cells · SSH-derived surface geostrophic velocities" + timeCoverage + " · " +
            (Number(geostrophicData["minimum_coriolis_s-1"]) === 0
                ? "full dataset; no Coriolis mask applied."
                : "|f| < " + Number(geostrophicData["minimum_coriolis_s-1"]).toExponential(1) + " s⁻¹ masked.");
        return true;
    }

    function selectGeostrophicRecord(record) {
        selection = null;
        selectedSites = [];
        selectedGeostrophicRecord = record;
        updateDrawingControls();
        renderExploreData(selectedRecords());
    }

    function renderGeostrophicSelection() {
        if (!geostrophicSelectionLayer || !window.L) return;
        geostrophicSelectionLayer.clearLayers();
        const draft = polygonDraft;
        if (draft.length) {
            const points = draft.map(function (point) { return [point.latitude, point.longitude]; });
            if (draft.length > 1) {
                const line = draft.length > 2
                    ? window.L.polygon(points, { color: "#f97316", weight: 2, fillOpacity: 0.12, dashArray: "5 5", interactive: false })
                    : window.L.polyline(points, { color: "#f97316", weight: 2, dashArray: "5 5", interactive: false });
                line.addTo(geostrophicSelectionLayer);
            }
            draft.forEach(function (point) {
                window.L.circleMarker([point.latitude, point.longitude], {
                    radius: 4, color: "#fff", weight: 2, fillColor: "#f97316", fillOpacity: 1,
                    interactive: false
                }).addTo(geostrophicSelectionLayer);
            });
        }
        if (selection && selection.coordinates && selection.coordinates.length) {
            const selectedPoints = selection.coordinates.map(function (point) {
                return [point.latitude, point.longitude];
            });
            const shape = selection.type === "polygon"
                ? window.L.polygon(selectedPoints, {
                    color: "#075985", weight: 2, fillColor: "#38bdf8", fillOpacity: 0.16, interactive: false
                })
                : window.L.circleMarker(selectedPoints[0], {
                    radius: 8, color: "#fff", weight: 2, fillColor: "#075985", fillOpacity: 1,
                    interactive: false
                });
            shape.addTo(geostrophicSelectionLayer);
        }
    }

    function renderMap() {
        const map = document.getElementById("site-map");
        const mapFrame = document.querySelector(".map-frame");
        const rasterVisible = document.getElementById("raster-toggle").checked;
        const pointsVisible = document.getElementById("points-toggle").checked;
        const geostrophicToggle = document.getElementById("geostrophic-toggle");
        const hasGeostrophicVectors = Boolean(
            geostrophicData && Array.isArray(geostrophicData.vectors) && geostrophicData.vectors.length
        );
        geostrophicToggle.disabled = !hasGeostrophicVectors || !window.L;
        if (hasGeostrophicVectors && geostrophicToggle.checked && isGeostrophicVariable(selectedVariable) &&
            renderGeostrophicLeaflet()) return;
        if (geostrophicLeafletMap) geostrophicLeafletMap.doubleClickZoom.enable();
        mapFrame.classList.remove("is-geostrophic");
        document.getElementById("draw-tools").hidden = false;
        document.getElementById("draw-buttons").hidden = false;
        document.getElementById("raster-toggle").closest("label").hidden = false;
        document.getElementById("raster-toggle").closest("label").querySelector("span").textContent = "(demo)";
        document.getElementById("raster-legend").hidden = false;
        document.getElementById("site-list").hidden = Boolean(selection);
        document.getElementById("community-filter").hidden = false;
        document.getElementById("map-variable").disabled = false;
        const raster = [];
        const rasterValues = demo.records.map(function (record) { return record[selectedVariable]; });
        const rasterMinimum = Math.min.apply(null, rasterValues);
        const rasterMaximum = Math.max.apply(null, rasterValues);
        const rasterRange = rasterMaximum - rasterMinimum || 1;
        for (let row = 0; row < demo.raster.rows; row += 1) {
            for (let column = 0; column < demo.raster.columns; column += 1) {
                const cellWidth = (mapPlot.right - mapPlot.left) / demo.raster.columns;
                const cellHeight = (mapPlot.bottom - mapPlot.top) / demo.raster.rows;
                const longitude = demo.raster.minLongitude + (column + 0.5) / demo.raster.columns *
                    (demo.raster.maxLongitude - demo.raster.minLongitude);
                const latitude = demo.raster.maxLatitude - (row + 0.5) / demo.raster.rows *
                    (demo.raster.maxLatitude - demo.raster.minLatitude);
                const rasterSample = sampleCell(longitude, latitude, demoDates.length - 1)[selectedVariable];
                const value = (rasterSample - rasterMinimum) / rasterRange;
                raster.push('<rect class="raster-cell" x="' + (mapPlot.left + column * cellWidth).toFixed(1) + '" y="' + (mapPlot.top + row * cellHeight).toFixed(1) +
                    '" width="' + cellWidth.toFixed(1) + '" height="' + cellHeight.toFixed(1) + '" fill="' + rasterColor(value) + '"></rect>');
            }
        }
        const horizontalLines = [mapPlot.top, 142.5, 250, 357.5, mapPlot.bottom].map(function (y) {
            return '<line class="map-grid-line" x1="' + mapPlot.left + '" y1="' + y + '" x2="' + mapPlot.right + '" y2="' + y + '"></line>';
        }).join("");
        const verticalLines = [mapPlot.left, 205, 350, 495, mapPlot.right].map(function (x) {
            return '<line class="map-grid-line" x1="' + x + '" y1="' + mapPlot.top + '" x2="' + x + '" y2="' + mapPlot.bottom + '"></line>';
        }).join("");
        const longitudeLabels = [
            { value: demo.raster.minLongitude, label: "3.99°W" },
            { value: -2.368, label: "2.37°W" },
            { value: -0.746, label: "0.75°W" },
            { value: 0.878, label: "0.88°E" },
            { value: demo.raster.maxLongitude, label: "2.50°E" }
        ].map(function (item) {
            const point = mapPoint({ longitude: item.value, latitude: demo.raster.minLatitude });
            return '<text class="map-axis-label" x="' + point.x.toFixed(1) + '" y="487" text-anchor="middle">' + item.label + '</text>';
        }).join("");
        const latitudeLabels = [
            { value: demo.raster.maxLatitude, label: "6.51°N" },
            { value: 5.134, label: "5.13°N" },
            { value: 3.758, label: "3.76°N" },
            { value: 2.382, label: "2.38°N" },
            { value: demo.raster.minLatitude, label: "1.01°N" }
        ].map(function (item) {
            const point = mapPoint({ longitude: demo.raster.minLongitude, latitude: item.value });
            return '<text class="map-axis-label" x="10" y="' + (point.y + 3).toFixed(1) + '">' + item.label + '</text>';
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
        document.getElementById("geostrophic-status").textContent = hasGeostrophicVectors
            ? window.L ? "Copernicus currents ready · enable the map layer to explore."
                : "Copernicus data found; Leaflet could not be loaded."
            : geostrophicLoadStatus;
        map.innerHTML = '<rect x="0" y="0" width="700" height="500" fill="#edf6f6"></rect>' +
            (rasterVisible ? '<g class="raster-layer" aria-label="Synthetic demo raster covering the displayed coordinate extent">' + raster.join("") + '</g>' : "") +
            '<g class="map-grid">' + horizontalLines + verticalLines + '</g>' +
            longitudeLabels + latitudeLabels +
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

        renderCommunityList(false);
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
                '<text class="chart-axis-label" x="' + (left - 8) + '" y="' + (y + 3) + '" text-anchor="end">' +
                value.toFixed(label.indexOf("m s") >= 0 ? 3 : 1) + '</text>';
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

    function renderExploreData(records) {
        const geostrophic = isGeostrophicVariable(selectedVariable);
        const variableLabel = geostrophic
            ? geostrophicVariableLabels[selectedVariable]
            : selectedVariable.toUpperCase();
        document.getElementById("records-title").textContent = geostrophic
            ? selectedGeostrophicRecord ? "Selected Copernicus grid cell"
                : selection ? selection.name + " · Copernicus grid cells"
                    : selectedSites.length ? "Community nearest Copernicus grid cells"
                        : "Copernicus geostrophic grid"
            : selection
                ? (selection.type === "point" ? "Point sample records" : "Polygon average records")
                : "Raw demonstration records";
        renderMetrics(records);
        renderTable(records);
        if (geostrophic) {
            const color = selectedVariable === "speed" ? "#ec7014" : "#4575b4";
            renderChart("geostrophic-chart", geostrophicChartRecords(), selectedVariable, color,
                geostrophicVariableUnits[selectedVariable]);
            document.getElementById("geostrophic-chart-title").textContent = variableLabel;
            document.getElementById("geostrophic-chart-note").textContent =
                "Daily Copernicus spatial mean from " + formatDate(startInput.value) + " to " +
                formatDate(endInput.value) + " · SSH-derived velocity, not CUTI or BEUTI.";
            return;
        }
        renderChart("cuti-chart", records, "cuti", "#078c83", "CUTI demo units");
        renderChart("beuti-chart", records, "beuti", "#e47e66", "BEUTI demo units");
    }

    function renderTable(records) {
        recordsBody.replaceChildren();
        const rows = records.slice().sort(function (a, b) {
            return isGeostrophicVariable(selectedVariable)
                ? a.id - b.id
                : b.date.localeCompare(a.date) || a.site.localeCompare(b.site);
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
        const geostrophic = isGeostrophicVariable(selectedVariable);
        variableHeading.replaceChildren(
            (geostrophic ? geostrophicVariableLabels[selectedVariable] : selectedVariable.toUpperCase()) + " "
        );
        const sourceLabel = document.createElement("span");
        sourceLabel.textContent = geostrophic ? "(Copernicus)" : "(demo)";
        variableHeading.appendChild(sourceLabel);
        emptyState.hidden = rows.length > 0;
        const moreButton = document.getElementById("show-more-records");
        const remainingRecords = rows.length - visibleRecordCount;
        moreButton.hidden = remainingRecords <= 0;
        moreButton.textContent = "Show 5 more (" + remainingRecords + " remaining)";
        document.getElementById("records-caption").textContent = "Showing " +
            Math.min(visibleRecordCount, rows.length) + " of " + rows.length +
            " matching " + (geostrophic ? "grid cells" : "records") + " for " +
            (geostrophic ? geostrophicVariableLabels[selectedVariable] : selectedVariable.toUpperCase()) +
            (geostrophic ? " · map mean " + formatDate(startInput.value) + " – " + formatDate(endInput.value) : ". Exports include all variables.");
        const location = selectedGeostrophicRecord
            ? selectedGeostrophicRecord.site + " · "
            : selection
            ? selection.name + " · "
            : selectedSites.length > 1
                ? selectedSites.length + " communities · "
                : selectedSites.length === 1
                    ? selectedSites[0] + " · "
                    : "";
        document.getElementById("filter-summary").textContent = location + records.length +
            (geostrophic ? " Copernicus grid cells · " : " demo records · ") +
            (geostrophic
                ? formatDate(startInput.value) + " – " + formatDate(endInput.value)
                : records.length ? formatDate(records[0].date) + " – " + formatDate(records[records.length - 1].date)
                    : "no matching dates");
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
        if (isGeostrophicVariable(selectedVariable)) {
            document.getElementById("draw-buttons").hidden = false;
            document.getElementById("draw-tools").hidden = false;
            finishButton.hidden = drawingMode !== "polygon" || polygonDraft.length < 3;
            cancelButton.hidden = !drawingMode;
            clearButton.hidden = !(selection || selectedGeostrophicRecord || selectedSites.length);
            if (drawingMode === "point") {
                instructions.textContent = "Click the map to sample the nearest Copernicus grid cell.";
            } else if (drawingMode === "polygon") {
                instructions.textContent = "Click to add polygon vertices; finish to average grid cells inside. " +
                    polygonDraft.length + " point" + (polygonDraft.length === 1 ? "" : "s") + " added.";
            } else if (selectedGeostrophicRecord) {
                instructions.textContent = selectedGeostrophicRecord.site +
                    " selected · values below show this Copernicus grid cell.";
            } else if (selection) {
                instructions.textContent = selection.type === "polygon"
                    ? selection.name + " selected · Explore Data shows its Copernicus grid cells."
                    : selection.name + " selected · Explore Data shows the nearest Copernicus grid cell.";
            } else if (selectedSites.length) {
                instructions.textContent = selectedSites.join(", ") +
                    " selected · using the nearest Copernicus grid cell for each approximate community location.";
            } else {
                instructions.textContent = "Click a raster cell or current arrow to inspect it, or select a community, point, or polygon.";
            }
            return;
        }
        document.getElementById("draw-buttons").hidden = false;
        document.getElementById("draw-tools").querySelector(".site-list-label").textContent =
            "Select an area on the map";
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
        document.getElementById("map-variable").value = selectedVariable;
        updateCommunityPicker();
        document.querySelectorAll(".chart-panel").forEach(function (panel) {
            panel.hidden = panel.dataset.variable !== (isGeostrophicVariable(selectedVariable) ? "geostrophic" : selectedVariable);
        });
        renderExploreData(records);
        renderMap();
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
        const geostrophic = isGeostrophicVariable(selectedVariable);
        if (format === "json") {
            download(
                geostrophic ? "ghana-geostrophic-snapshot.json" : "ghana-upwelling-demo.json",
                JSON.stringify(records, null, 2),
                "application/json"
            );
            return;
        }
        const columns = geostrophic
            ? ["date", "site", "latitude", "longitude", "speed", "eastward", "northward"]
            : ["date", "site", "latitude", "longitude", "cuti", "beuti"];
        const csv = [columns.join(",")].concat(records.map(function (record) {
            return columns.map(function (column) {
                const value = String(record[column]);
                return '"' + value.replace(/"/g, '""') + '"';
            }).join(",");
        })).join("\r\n");
        download(
            geostrophic ? "ghana-geostrophic-snapshot.csv" : "ghana-upwelling-demo.csv",
            csv,
            "text/csv;charset=utf-8"
        );
    }

    document.querySelectorAll(".chart-download").forEach(function (button) {
        button.addEventListener("click", function () {
            const svg = document.getElementById(button.dataset.chart + "-chart");
            const clone = svg.cloneNode(true);
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            clone.setAttribute("width", "1240");
            clone.setAttribute("height", "470");
            download(button.dataset.chart + (button.dataset.chart === "geostrophic" ? "-copernicus" : "-demo") +
                "-chart.svg", new XMLSerializer().serializeToString(clone), "image/svg+xml;charset=utf-8");
        });
    });
    document.getElementById("map-variable").addEventListener("change", function (event) {
        selectedVariable = event.target.value;
        selectedGeostrophicRecord = null;
        selection = null;
        drawingMode = null;
        polygonDraft = [];
        selectedSites = [];
        configureDateFilters();
        updateGeostrophicFrame();
        document.getElementById("geostrophic-toggle").checked =
            isGeostrophicVariable(selectedVariable) && Boolean(window.L);
        if (isGeostrophicVariable(selectedVariable)) document.getElementById("raster-toggle").checked = true;
        updateDrawingControls();
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
        selectedGeostrophicRecord = null;
        drawingSnapshot = null;
        drawingMode = null;
        polygonDraft = [];
        selectedSites = [];
        if (geostrophicLeafletMap) geostrophicLeafletMap.doubleClickZoom.enable();
        configureDateFilters();
        updateDrawingControls();
        render();
    });
    communityOptions.addEventListener("change", function (event) {
        if (event.target.type !== "checkbox") return;
        selection = null;
        selectedGeostrophicRecord = null;
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
        input.addEventListener("change", function (event) {
            if (event.target === startInput && startInput.value > endInput.value) {
                endInput.value = startInput.value;
            } else if (event.target === endInput && endInput.value < startInput.value) {
                startInput.value = endInput.value;
            }
            updateGeostrophicFrame();
            render();
        });
    });
    [document.getElementById("raster-toggle"), document.getElementById("points-toggle")].forEach(function (input) {
        input.addEventListener("change", renderMap);
    });
    document.getElementById("geostrophic-toggle").addEventListener("change", function (event) {
        selection = null;
        drawingSnapshot = null;
        drawingMode = null;
        polygonDraft = [];
        selectedSites = [];
        if (event.target.checked && geostrophicRecords.length) {
            selectedVariable = "speed";
            selectedGeostrophicRecord = null;
        } else if (isGeostrophicVariable(selectedVariable)) {
            selectedVariable = "cuti";
            selectedGeostrophicRecord = null;
        }
        configureDateFilters();
        updateGeostrophicFrame();
        updateDrawingControls();
        render();
    });
    document.getElementById("zoom-in").addEventListener("click", function () { zoomMap(1.4); });
    document.getElementById("zoom-out").addEventListener("click", function () { zoomMap(1 / 1.4); });
    document.getElementById("zoom-reset").addEventListener("click", function () {
        mapView = { x: defaultMapView.x, y: defaultMapView.y, width: defaultMapView.width, height: defaultMapView.height };
        document.getElementById("site-map").setAttribute("viewBox",
            [mapView.x, mapView.y, mapView.width, mapView.height].join(" "));
    });
    document.getElementById("draw-point").addEventListener("click", function () {
        drawingSnapshot = drawingSnapshot || {
            selection: selection,
            sites: selectedSites.slice(),
            record: selectedGeostrophicRecord
        };
        selection = null;
        selectedGeostrophicRecord = null;
        selectedSites = [];
        drawingMode = "point";
        polygonDraft = [];
        if (geostrophicLeafletMap) geostrophicLeafletMap.doubleClickZoom.enable();
        updateDrawingControls();
        render();
    });
    document.getElementById("draw-polygon").addEventListener("click", function () {
        drawingSnapshot = drawingSnapshot || {
            selection: selection,
            sites: selectedSites.slice(),
            record: selectedGeostrophicRecord
        };
        selection = null;
        selectedGeostrophicRecord = null;
        selectedSites = [];
        drawingMode = "polygon";
        polygonDraft = [];
        if (geostrophicLeafletMap && isGeostrophicVariable(selectedVariable)) {
            geostrophicLeafletMap.doubleClickZoom.disable();
        }
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
        selectedGeostrophicRecord = null;
        selectedSites = [];
        drawingSnapshot = null;
        drawingMode = null;
        polygonDraft = [];
        if (geostrophicLeafletMap) geostrophicLeafletMap.doubleClickZoom.enable();
        updateDrawingControls();
        render();
    });
    document.getElementById("cancel-drawing").addEventListener("click", function () {
        if (drawingSnapshot) {
            selection = drawingSnapshot.selection;
            selectedSites = drawingSnapshot.sites;
            selectedGeostrophicRecord = drawingSnapshot.record || null;
        }
        drawingSnapshot = null;
        drawingMode = null;
        polygonDraft = [];
        if (geostrophicLeafletMap) geostrophicLeafletMap.doubleClickZoom.enable();
        updateDrawingControls();
        render();
    });
    document.getElementById("clear-selection").addEventListener("click", function () {
        selection = null;
        selectedGeostrophicRecord = null;
        selectedSites = [];
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
            selectedGeostrophicRecord = null;
            selectedSites = [];
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
