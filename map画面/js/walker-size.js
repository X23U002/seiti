// =========================================================
// 3Dキャラクターの大きさ（walker.js から使う。three.js を使わないので、テストからも読み込める）
//
// キャラクターの実際の大きさ（m）を決めて、建物や道と同じように写す。
// 寄せると大きく、引くと小さく写り、街と比べた大きさはいつも同じ（巨人になったり縮んだりしない）。
// 引いて画面上で小さくなりすぎたら、キャラクターを隠して青い現在地の点に切りかえる
// =========================================================

// キャラクターの実際の高さ（m）。本物の背丈（約1.7m）だとふだんのズームでは見えないので、大きめにする
// （ズーム17で画面上 約80px、地図の一番寄せたズーム18で約160px）
export const MODEL_HEIGHT_METERS = 40;

// 画面上でこれより小さくなったら、キャラクターを隠して青い現在地の点に切りかえる（px。ズーム15あたり）
export const MIN_VISIBLE_PX = 20;

// その場所で、キャラクターが画面上に何pxに写るか（斜めから見た時の手前・奥の違いも入る）
export function modelScreenHeightPx(map, lng, lat) {
    const pixelsPerMeter = screenPixelsPerMeter(map, lng, lat) ||
        1 / metersPerPixel(lat, map.getZoom());
    return MODEL_HEIGHT_METERS * pixelsPerMeter;
}

// その場所でキャラクターを出すか（画面上で小さくなりすぎたら出さず、現在地の点にする）
export function isModelVisible(map, lng, lat) {
    return modelScreenHeightPx(map, lng, lat) >= MIN_VISIBLE_PX;
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
