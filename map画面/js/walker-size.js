// =========================================================
// 3Dキャラクターの大きさ（walker.js から使う。three.js を使わないので、テストからも読み込める）
//
// 画面上の高さを決めて、その高さに見える実際の大きさ（m）を求める。
// 3D表示では地図を斜めから見るので、同じ大きさでも手前（画面の下）は大きく、奥は小さく写る。
// 画面の真ん中の縮尺で決めると、キャラクターが手前に来た時に巨大になるので、
// キャラクターが今いる場所の縮尺で決める
// =========================================================

// 画面上でのキャラクターの高さ（px）。ズームを寄せても引いても、この高さで固定する。
// 引いた時に目立ちすぎないよう小さめ（3D表示のピン 42px より少し大きいくらい）
export const MODEL_SCREEN_HEIGHT_PX = 64;

// そのズームでの、画面上のキャラクターの高さ（px）。どのズームでも同じ
export function modelScreenHeightPx() {
    return MODEL_SCREEN_HEIGHT_PX;
}

// これより引いたら、キャラクターを隠して青い現在地の点に切りかえる。
// 画面上の大きさは固定なので、引いたまま出すと、県や地方より大きな巨人に見えてしまう
export const MIN_VISIBLE_ZOOM = 20;

// そのズームでキャラクターを出すか（出す時は、いつも同じ大きさ）
export function isModelVisibleAtZoom(zoom) {
    return zoom >= MIN_VISIBLE_ZOOM;
}

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
