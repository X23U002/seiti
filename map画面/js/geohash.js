// ==========================================
// 緯度経度から geohash を作る（聖地の geo_hash に入れる。管理ページ・聖地の一括編集で共通）
// ==========================================
export function encodeGeohash(latitude, longitude, precision) {
    const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    const latRange = [-90, 90];
    const lngRange = [-180, 180];
    let hash = "";
    let bit = 0;
    let ch = 0;
    let even = true;

    while (hash.length < precision) {
        const range = even ? lngRange : latRange;
        const value = even ? longitude : latitude;
        const mid = (range[0] + range[1]) / 2;
        if (value >= mid) {
            ch = (ch << 1) | 1;
            range[0] = mid;
        } else {
            ch = ch << 1;
            range[1] = mid;
        }
        even = !even;
        if (++bit === 5) {
            hash += base32[ch];
            bit = 0;
            ch = 0;
        }
    }
    return hash;
}
