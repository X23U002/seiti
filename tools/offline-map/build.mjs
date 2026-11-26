// ==========================================
// 圏外用の OSM の地図（聖地のまわりだけ）を作る
//   cd tools/offline-map && npm install && npm run build
// ・聖地の一覧をデータベース（Firestore の Web API）から読み、近い聖地をまとめて「地域」にする
// ・Protomaps が毎日作っている OpenStreetMap の地図データ（build.protomaps.com の .pmtiles）から、
//   地域のまわりのタイルだけを取り出して map画面/offline-map/tiles/{z}/{x}/{y}.pbf に置く（gzip で縮めたもの）
//   （地図データ © OpenStreetMap contributors。ODbL）
// ・地域ごとのタイルの一覧を map画面/offline-map/regions.json に書く（アプリが地域ごとに端末へ残す）
// ・地名の英数字の文字（フォント）も map画面/offline-map/fonts/ に置く（日本語は端末の文字で描く）
// 聖地を新しい地域に足した時は、これを動かし直してコミットする
// ==========================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { PMTiles } from "pmtiles";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../../map画面/offline-map");
const SPOT_URL = "https://firestore.googleapis.com/v1/projects/sisukai-121cf/databases/(default)/documents/spot" +
    "?pageSize=300&mask.fieldPaths=coord&mask.fieldPaths=title_name&mask.fieldPaths=spot_name";

// 近い聖地をまとめる距離・地域のまわりに足す余白（m）・取り出すズーム
const JOIN_METERS = 2000;
const MARGIN_METERS = 1200;
const MIN_ZOOM = 12;
// 15 以上はズーム 14 のタイルを拡大して描く（地図の大きさを抑えるため）
const MAX_ZOOM = 14;
// 地域を見渡すための、引いた地図（地域を含む広い範囲）
const OVERVIEW_ZOOMS = [];
const FONTS = ["Noto Sans Regular", "Noto Sans Medium"];
const FONT_URL = "https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts/";

function distanceMeters(a, b) {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r;
    const dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

function tileX(lng, z) { return Math.floor((lng + 180) / 360 * 2 ** z); }
function tileY(lat, z) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** z);
}

async function loadSpots() {
    const spots = [];
    let token = "";
    do {
        const res = await fetch(SPOT_URL + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
        if (!res.ok) throw new Error("聖地を読めませんでした: " + res.status);
        const json = await res.json();
        (json.documents || []).forEach((doc) => {
            const f = doc.fields || {};
            if (!f.coord) return;
            spots.push({
                id: doc.name.split("/").pop(),
                lat: f.coord.geoPointValue.latitude,
                lng: f.coord.geoPointValue.longitude,
                title: f.title_name ? f.title_name.stringValue : ""
            });
        });
        token = json.nextPageToken || "";
    } while (token);
    return spots;
}

// 近い聖地をまとめる（JOIN_METERS 以内でつながるものを1つの地域に）
function groupSpots(spots) {
    const parent = spots.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
            if (distanceMeters(spots[i], spots[j]) <= JOIN_METERS) parent[find(i)] = find(j);
        }
    }
    const groups = new Map();
    spots.forEach((spot, i) => {
        const key = find(i);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(spot);
    });
    return Array.from(groups.values());
}

function regionBounds(group) {
    const lats = group.map((s) => s.lat);
    const lngs = group.map((s) => s.lng);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const dLat = MARGIN_METERS / 111320;
    const dLng = MARGIN_METERS / (111320 * Math.cos(midLat * Math.PI / 180));
    return [Math.min(...lngs) - dLng, Math.min(...lats) - dLat, Math.max(...lngs) + dLng, Math.max(...lats) + dLat];
}

function tilesIn(bounds, z) {
    const [west, south, east, north] = bounds;
    const list = [];
    for (let x = tileX(west, z); x <= tileX(east, z); x++) {
        for (let y = tileY(north, z); y <= tileY(south, z); y++) list.push([z, x, y]);
    }
    return list;
}

async function findPlanet() {
    if (process.env.PLANET) return process.env.PLANET;
    for (let i = 0; i < 10; i++) {
        const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
        const url = `https://build.protomaps.com/${day}.pmtiles`;
        const res = await fetch(url, { headers: { Range: "bytes=0-126" } });
        if (res.status === 206) return url;
    }
    throw new Error("Protomaps の地図データが見つかりませんでした");
}

async function main() {
    const planetUrl = await findPlanet();
    console.log("地図データ:", planetUrl);
    const planet = new PMTiles(planetUrl);

    const spots = await loadSpots();
    const groups = groupSpots(spots);
    console.log(`聖地 ${spots.length} か所 → 地域 ${groups.length}`);

    fs.rmSync(path.join(OUT, "tiles"), { recursive: true, force: true });
    const written = new Map(); // "z/x/y" → bytes

    async function writeTile([z, x, y]) {
        const key = `${z}/${x}/${y}`;
        if (written.has(key)) return written.get(key);
        const tile = await planet.getZxy(z, x, y);
        let bytes = 0;
        if (tile && tile.data && tile.data.byteLength > 0) {
            const file = path.join(OUT, "tiles", String(z), String(x), `${y}.pbf`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            // gzip で縮めて置く（service worker が開いて地図に渡す。sw.js）
            const packed = zlib.gzipSync(Buffer.from(tile.data), { level: 9 });
            fs.writeFileSync(file, packed);
            bytes = packed.length;
        }
        written.set(key, bytes);
        return bytes;
    }

    const regions = [];
    for (const group of groups) {
        const bounds = regionBounds(group);
        const tiles = [];
        for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) tiles.push(...tilesIn(bounds, z));
        for (const z of OVERVIEW_ZOOMS) tiles.push(...tilesIn(bounds, z));
        const keys = [];
        let bytes = 0;
        // 4つずつ同時に取る
        for (let i = 0; i < tiles.length; i += 4) {
            const sizes = await Promise.all(tiles.slice(i, i + 4).map(writeTile));
            tiles.slice(i, i + 4).forEach((t, j) => {
                if (sizes[j] > 0) {
                    keys.push(t.join("/"));
                    bytes += sizes[j];
                }
            });
        }
        // いちばん多い作品の名前を、地域の目印にする
        const counts = {};
        group.forEach((s) => { counts[s.title] = (counts[s.title] || 0) + 1; });
        const title = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        regions.push({
            id: "r" + regions.length,
            title: title,
            spotIds: group.map((s) => s.id),
            bounds: bounds.map((v) => Math.round(v * 1e5) / 1e5),
            tiles: keys,
            bytes: bytes
        });
        console.log(`  ${title}（${group.length} か所）: タイル ${keys.length} 枚・${(bytes / 1024 / 1024).toFixed(1)}MB`);
    }

    fs.writeFileSync(path.join(OUT, "regions.json"), JSON.stringify({
        source: planetUrl.split("/").pop(),
        attribution: "© OpenStreetMap contributors",
        maxzoom: MAX_ZOOM,
        regions: regions
    }, null, 1) + "\n");

    // 地名の英数字の文字（日本語は端末の文字で描く）
    for (const font of FONTS) {
        const res = await fetch(FONT_URL + encodeURIComponent(font) + "/0-255.pbf");
        if (!res.ok) throw new Error("文字を読めませんでした: " + font);
        const file = path.join(OUT, "fonts", font, "0-255.pbf");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }

    const total = Array.from(written.values()).reduce((a, b) => a + b, 0);
    console.log(`合計 タイル ${Array.from(written.values()).filter(Boolean).length} 枚・${(total / 1024 / 1024).toFixed(1)}MB`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
