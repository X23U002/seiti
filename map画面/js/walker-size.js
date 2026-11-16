// =========================================================
// 3Dキャラクターの大きさ（walker.js から使う。three.js を使わないので、テストからも読み込める）
//
// 画面上の高さを決めて、その高さに見える実際の大きさ（m）を求める。
// 3D表示では地図を斜めから見るので、同じ大きさでも手前（画面の下）は大きく、奥は小さく写る。
// 画面の真ん中の縮尺で決めると、キャラクターが手前に来た時に巨大になるので、
// キャラクターが今いる場所の縮尺で決める
// =========================================================

// 地図上で 1px が何mか（Mapboxのタイルは512px。画面の真ん中・真上から見た時）
export function metersPerPixel(lat, zoom) {
    return 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, zoom));
}

// その場所で、画面の横方向に 1m が何pxに写るか（取れなければ null）。
// 横方向（地図の向きに直角）なら、斜めから見ても縮まないので、手前・奥の写り方だけが分かる
export function screenPixelsPerMeter(map, lng, lat) {
    const SAMPLE_METERS = 10;
    const azimuth = (map.getBearing() + 90) * Math.PI / 180;
    const dLat = (SAMPLE_METERS * Math.cos(azimuth)) / 111320;
    const dLng = (SAMPLE_METERS * Math.sin(azimuth)) / (111320 * Math.cos(lat * Math.PI / 180));

    const a = map.project([lng, lat]);
    const b = map.project([lng + dLng, lat + dLat]);
    const pixels = Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE_METERS;

    return Number.isFinite(pixels) && pixels > 0 ? pixels : null;
}

// 画面上で screenPx の高さに見える大きさ（m）。
// その場所の縮尺が取れない時（画面の外など）は、画面の真ん中の縮尺で決める
export function heightMetersForScreen(map, lng, lat, screenPx) {
    const pixelsPerMeter = screenPixelsPerMeter(map, lng, lat);
    return pixelsPerMeter
        ? screenPx / pixelsPerMeter
        : screenPx * metersPerPixel(lat, map.getZoom());
}
