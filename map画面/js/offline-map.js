// ==========================================
// 圏外用の地図（国土地理院の地理院タイル・淡色地図）
// ・Mapbox の地図の絵は決まりで端末に残せないので、圏外の時は地理院タイルで地図を出す
//   （出典の「国土地理院」を出せば使える。https://maps.gsi.go.jp/development/ichiran.html）
// ・電波がある時に見た場所の地図を、裏で端末に残す（saveVisibleTiles）
// ・出かける前に、ルートの聖地のまわりの地図をまとめて残せる（saveTilesAround）
// ・圏外の時は、オフライン用の service worker（sw.js）が残した地図を出す
// ・地理院のサーバーに負担をかけないよう、1回に残す枚数と、全部で残す枚数に上限を付ける
// ==========================================

export const TILE_CACHE = "seiti-offline-map-v1";
const TILE_HOST = "https://cyberjapandata.gsi.go.jp/xyz/pale/";
export const TILE_URL = TILE_HOST + "{z}/{x}/{y}.png";

// 地図を見ている時に残す（寄せている時だけ。引いた広い範囲は枚数が多すぎる）
const AUTO_MIN_ZOOM = 14;
const AUTO_MAX_TILES = 40;
// 全部で残す枚数（1枚 約20KB。これを超えたら古いものから消す）
const MAX_TILES = 3000;
// ルートの周りを残す時：聖地のまわり何mを、どのズームで
const AROUND_METERS = 350;
const AROUND_ZOOMS = [14, 15, 16, 17];
// 地理院タイルの淡色地図は 5〜18
const MIN_TILE_ZOOM = 5;
const MAX_TILE_ZOOM = 18;

// 圏外の時の地図（残した地理院タイル。残していない所は、うすい地面の色）
export const OFFLINE_MAP_STYLE = {
    version: 8,
    sources: {
        "offline-gsi": {
            type: "raster",
            tiles: [TILE_URL],
            tileSize: 256,
            minzoom: MIN_TILE_ZOOM,
            maxzoom: MAX_TILE_ZOOM,
            attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>'
        }
    },
    layers: [
        { id: "offline-background", type: "background", paint: { "background-color": "#e9eee8" } },
        { id: "offline-gsi", type: "raster", source: "offline-gsi" }
    ]
};

export function tileUrl(z, x, y) {
    return TILE_HOST + z + "/" + x + "/" + y + ".png";
}

function lngToTileX(lng, z) {
    return Math.floor((lng + 180) / 360 * Math.pow(2, z));
}

function latToTileY(lat, z) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
}

// 範囲（west, south, east, north）にかかるタイルの URL
export function tilesInBounds(west, south, east, north, z) {
    const urls = [];
    const x0 = lngToTileX(west, z);
    const x1 = lngToTileX(east, z);
    const y0 = latToTileY(north, z);
    const y1 = latToTileY(south, z);
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            urls.push(tileUrl(z, x, y));
        }
    }
    return urls;
}

function hasCaches() {
    return typeof caches !== "undefined" && typeof caches.open === "function";
}

// まだ残していないタイルだけを取りにいって残す。残した枚数を返す
// onProgress(済んだ数, 全部の数)
async function saveTiles(urls, onProgress) {
    if (!hasCaches() || urls.length === 0) return 0;
    const cache = await caches.open(TILE_CACHE);
    let saved = 0;
    let done = 0;

    // 同時に4枚まで（地理院のサーバーに負担をかけないように）
    const queue = urls.slice();
    async function worker() {
        while (queue.length > 0) {
            const url = queue.shift();
            try {
                if (!(await cache.match(url))) {
                    const response = await fetch(url, { mode: "cors" });
                    if (response.ok) {
                        await cache.put(url, response);
                        saved += 1;
                    }
                }
            } catch (error) {
                // 取れなかったタイルは飛ばす（圏外・地図の無い海など）
            }
            done += 1;
            if (onProgress) onProgress(done, urls.length);
        }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);

    if (saved > 0) await trimTiles(cache);
    return saved;
}

// 全部で残す枚数を超えたら、古く残したものから消す
async function trimTiles(cache) {
    const keys = await cache.keys();
    const extra = keys.length - MAX_TILES;
    for (let i = 0; i < extra; i++) {
        await cache.delete(keys[i]);
    }
}

// 今見ている範囲の地図を残す（寄せている時だけ。今のズームと1つ引いたズーム）
let autoTimer = null;
export function saveVisibleTilesSoon(map) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
        saveVisibleTiles(map);
    }, 1500);
}

export async function saveVisibleTiles(map) {
    if (navigator.onLine === false) return 0;
    const zoom = Math.floor(map.getZoom());
    if (zoom < AUTO_MIN_ZOOM) return 0;
    const bounds = map.getBounds();
    const urls = [];
    [Math.min(zoom, MAX_TILE_ZOOM), Math.min(zoom - 1, MAX_TILE_ZOOM)].forEach(function (z) {
        tilesInBounds(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(), z)
            .forEach(function (url) { urls.push(url); });
    });
    return saveTiles(urls.slice(0, AUTO_MAX_TILES));
}

// 聖地のまわり（AROUND_METERS）の地図を、いくつかのズームでまとめて残す
// points：[{ latitude, longitude }]
export function tilesAround(points) {
    const urls = new Set();
    points.forEach(function (point) {
        const dLat = AROUND_METERS / 111320;
        const dLng = AROUND_METERS / (111320 * Math.cos(point.latitude * Math.PI / 180));
        AROUND_ZOOMS.forEach(function (z) {
            tilesInBounds(point.longitude - dLng, point.latitude - dLat, point.longitude + dLng, point.latitude + dLat, z)
                .forEach(function (url) { urls.add(url); });
        });
    });
    return Array.from(urls);
}

export function saveTilesAround(points, onProgress) {
    return saveTiles(tilesAround(points), onProgress);
}
