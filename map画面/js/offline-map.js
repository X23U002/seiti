// ==========================================
// 圏外用の地図（OpenStreetMap の地図データを、聖地のまわりだけこのサイトに置いたもの）
// ・Mapbox の地図の絵は決まりで端末に残せないので、圏外の時はこの地図を出す
//   （地図データ © OpenStreetMap contributors。tools/offline-map/build.mjs で作る）
// ・地図データは「地域」（近い聖地をまとめたもの）ごとに offline-map/tiles/ に置いてあり、
//   一覧は offline-map/regions.json
// ・電波がある時に聖地の地域を見たら、その地域の地図を裏で端末に残す（saveRegionNearSoon）
// ・出かける前に、ルートの聖地がある地域の地図をまとめて残せる（saveTilesAround）
// ・圏外の時は、オフライン用の service worker（sw.js）が残した地図を出す
// ==========================================

// 端末に残す場所（sw.js の TILE_CACHE と同じ名前）
export const TILE_CACHE = "seiti-offline-map-v2";
const BASE = new URL("../offline-map/", import.meta.url).href;
const FONT_RANGES = ["Noto Sans Regular/0-255.pbf", "Noto Sans Medium/0-255.pbf"];

const NAME = ["coalesce", ["get", "name:ja"], ["get", "name"]];
const GREEN_KINDS = ["park", "grass", "wood", "forest", "cemetery", "pitch", "playground", "garden", "grassland", "scrub", "golf_course", "nature_reserve"];

// 圏外の時の地図（地域の外・ズーム 12 より引いた所は、うすい地面の色だけ）
export const OFFLINE_MAP_STYLE = {
    version: 8,
    glyphs: BASE + "fonts/{fontstack}/{range}.pbf",
    sources: {
        "offline-osm": {
            type: "vector",
            tiles: [BASE + "tiles/{z}/{x}/{y}.pbf"],
            minzoom: 12,
            maxzoom: 14,
            attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
        }
    },
    layers: [
        { id: "offline-background", type: "background", paint: { "background-color": "#e9eee8" } },
        { id: "offline-earth", type: "fill", source: "offline-osm", "source-layer": "earth", paint: { "fill-color": "#f4f1ea" } },
        {
            id: "offline-green", type: "fill", source: "offline-osm", "source-layer": "landuse",
            filter: ["in", ["get", "kind"], ["literal", GREEN_KINDS]],
            paint: { "fill-color": "#d3e9c8" }
        },
        {
            id: "offline-school", type: "fill", source: "offline-osm", "source-layer": "landuse",
            filter: ["in", ["get", "kind"], ["literal", ["school", "kindergarten", "university", "college", "hospital"]]],
            paint: { "fill-color": "#f1e6d6" }
        },
        { id: "offline-water", type: "fill", source: "offline-osm", "source-layer": "water", paint: { "fill-color": "#a9d3ef" } },
        {
            id: "offline-building", type: "fill", source: "offline-osm", "source-layer": "buildings", minzoom: 14,
            paint: { "fill-color": "#e2ddd3", "fill-outline-color": "#d2ccc0" }
        },
        {
            id: "offline-rail", type: "line", source: "offline-osm", "source-layer": "roads",
            filter: ["==", ["get", "kind"], "rail"],
            paint: { "line-color": "#9aa6b2", "line-width": 2, "line-dasharray": [3, 2] }
        },
        {
            id: "offline-road-casing", type: "line", source: "offline-osm", "source-layer": "roads",
            filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road", "minor_road"]]],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": "#d6cfc2",
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 10, 18, 22]
            }
        },
        {
            id: "offline-path", type: "line", source: "offline-osm", "source-layer": "roads",
            filter: ["==", ["get", "kind"], "path"],
            paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 18, 4] }
        },
        {
            id: "offline-road", type: "line", source: "offline-osm", "source-layer": "roads",
            filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road", "minor_road"]]],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": ["match", ["get", "kind"], "highway", "#f6c467", "major_road", "#fde9a6", "#ffffff"],
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 8, 18, 18]
            }
        },
        {
            id: "offline-road-name", type: "symbol", source: "offline-osm", "source-layer": "roads", minzoom: 15,
            filter: ["all", ["in", ["get", "kind"], ["literal", ["highway", "major_road", "minor_road"]]], ["has", "name"]],
            layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11 },
            paint: { "text-color": "#6b5d4f", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }
        },
        {
            id: "offline-poi", type: "symbol", source: "offline-osm", "source-layer": "pois", minzoom: 15,
            filter: ["all", ["has", "name"], ["in", ["get", "kind"], ["literal", ["station", "place_of_worship", "park", "school", "hospital", "library", "townhall", "post_office", "museum", "attraction", "shrine", "temple"]]]],
            layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 8 },
            paint: { "text-color": "#7a6a58", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }
        },
        {
            id: "offline-station", type: "symbol", source: "offline-osm", "source-layer": "pois",
            filter: ["all", ["has", "name"], ["==", ["get", "kind"], "station"]],
            layout: { "text-field": NAME, "text-font": ["Noto Sans Medium"], "text-size": 13 },
            paint: { "text-color": "#2c3e50", "text-halo-color": "#ffffff", "text-halo-width": 2 }
        },
        {
            id: "offline-place", type: "symbol", source: "offline-osm", "source-layer": "places",
            filter: ["has", "name"],
            layout: { "text-field": NAME, "text-font": ["Noto Sans Medium"], "text-size": 13, "text-max-width": 8 },
            paint: { "text-color": "#4a4a4a", "text-halo-color": "#ffffff", "text-halo-width": 2 }
        }
    ]
};

function hasCaches() {
    return typeof caches !== "undefined" && typeof caches.open === "function";
}

// 地域の一覧（regions.json）
let regionsPromise = null;
export function loadRegions() {
    if (!regionsPromise) {
        regionsPromise = fetch(BASE + "regions.json")
            .then(function (response) {
                if (!response.ok) throw new Error("regions.json " + response.status);
                return response.json();
            })
            .then(function (json) { return json.regions || []; })
            .catch(function (error) {
                regionsPromise = null;
                throw error;
            });
    }
    return regionsPromise;
}

function inBounds(region, point) {
    const [west, south, east, north] = region.bounds;
    return point.longitude >= west && point.longitude <= east && point.latitude >= south && point.latitude <= north;
}

// その地点がある地域
export async function regionsFor(points) {
    const regions = await loadRegions();
    return regions.filter(function (region) {
        return points.some(function (point) { return inBounds(region, point); });
    });
}

function regionUrls(region) {
    return region.tiles.map(function (tile) { return BASE + "tiles/" + tile + ".pbf"; });
}

// 地域の地図を、もう端末に残してあるか（最初と最後のタイルで見る）
async function isRegionSaved(cache, region) {
    const urls = regionUrls(region);
    if (urls.length === 0) return true;
    return Boolean((await cache.match(urls[0])) && (await cache.match(urls[urls.length - 1])));
}

// 地域の地図（と文字）を端末に残す。新しく残した地域の数を返す
// onProgress(済んだ数, 全部の数)
async function saveRegions(regions, onProgress) {
    if (!hasCaches()) return 0;
    const cache = await caches.open(TILE_CACHE);
    const todo = [];
    for (const region of regions) {
        if (!(await isRegionSaved(cache, region))) todo.push(region);
    }
    if (todo.length === 0) return 0;

    const urls = FONT_RANGES.map(function (font) { return BASE + "fonts/" + font; })
        .concat(...todo.map(regionUrls));
    let done = 0;
    const queue = urls.slice();
    async function worker() {
        while (queue.length > 0) {
            const url = queue.shift();
            try {
                if (!(await cache.match(url))) {
                    const response = await fetch(url);
                    if (response.ok) await cache.put(url, response);
                }
            } catch (error) {
                // 取れなかったものは飛ばす（次に保存する時に取り直す）
            }
            done += 1;
            if (onProgress) onProgress(done, urls.length);
        }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    return todo.length;
}

// ルートの聖地がある地域の地図をまとめて残す（📥）
// 戻り値：{ regions: 聖地がある地域の数, saved: 新しく残した地域の数 }
export async function saveTilesAround(points, onProgress) {
    const regions = await regionsFor(points);
    const saved = await saveRegions(regions, onProgress);
    return { regions: regions.length, saved: saved };
}

// 電波がある時に、聖地の地域を見ていたら、その地域の地図を裏で残す（1回開いている間に1地域1回）
const triedRegions = new Set();
let nearTimer = null;
export function saveRegionNearSoon(map) {
    clearTimeout(nearTimer);
    nearTimer = setTimeout(function () {
        saveRegionNear(map).catch(function () {
            // 残せなくても地図はそのまま使える
        });
    }, 1500);
}

export async function saveRegionNear(map) {
    if (navigator.onLine === false || map.getZoom() < 12) return 0;
    const center = map.getCenter();
    const regions = (await regionsFor([{ latitude: center.lat, longitude: center.lng }]))
        .filter(function (region) { return !triedRegions.has(region.id); });
    regions.forEach(function (region) { triedRegions.add(region.id); });
    return saveRegions(regions);
}
