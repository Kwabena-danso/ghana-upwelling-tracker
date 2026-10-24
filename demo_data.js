(function () {
    const sites = [
        { name: "Cape Three Points", latitude: 4.74, longitude: -2.08 },
        { name: "Takoradi", latitude: 4.89, longitude: -1.76 },
        { name: "Accra", latitude: 5.55, longitude: -0.19 }
    ];
    const dates = [
        "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14",
        "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18",
        "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
        "2026-10-23", "2026-10-24"
    ];

    window.GHANA_UPWELLING_DEMO = {
        sites: sites,
        records: sites.flatMap(function (site, siteIndex) {
            return dates.map(function (date, dayIndex) {
                const phase = dayIndex * 0.61 + siteIndex * 0.9;
                return {
                    date: date,
                    site: site.name,
                    latitude: site.latitude,
                    longitude: site.longitude,
                    cuti: Number((0.38 + 0.23 * Math.sin(phase) + siteIndex * 0.045).toFixed(3)),
                    beuti: Number((1.7 + 0.82 * Math.cos(phase * 0.78) + siteIndex * 0.21).toFixed(3))
                };
            });
        })
    };
}());
