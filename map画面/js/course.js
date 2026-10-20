// ==========================================
// おすすめ聖地巡礼ルート（地図・管理ページで共通）
// course コレクション：おすすめルート1件につき1件（管理者が作る・誰でも読める）
//   { title_name: 作品名, course_name: ルート名, description: 紹介文,
//     spot_ids: [スポットID, ...（回る順）], updated_at: 更新日時 }
// ==========================================

export const COURSE_COLLECTION = "course";

// おすすめルートに入れられる聖地の数
export const COURSE_MIN_SPOTS = 2;
export const COURSE_MAX_SPOTS = 30;

// 2地点の距離（メートル）
export function distanceMeters(a, b) {
    const toRad = Math.PI / 180;
    const lat1 = Number(a.latitude) * toRad;
    const lat2 = Number(b.latitude) * toRad;
    const dLat = lat2 - lat1;
    const dLng = (Number(b.longitude) - Number(a.longitude)) * toRad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// 回る順に並んだ聖地の、合計の距離（直線距離の合計・メートル）
export function courseDistance(spots) {
    let total = 0;
    for (let i = 1; i < spots.length; i++) {
        if (spots[i - 1].coord && spots[i].coord) {
            total += distanceMeters(spots[i - 1].coord, spots[i].coord);
        }
    }
    return total;
}

// 「約2.4km・徒歩 約40分」のような目安
// 道は直線より長いので 1.3 倍し、歩く速さは 分速80m として計算する
export function formatCourseLength(meters) {
    const walkMinutes = Math.max(1, Math.round(meters * 1.3 / 80));
    const distance = meters < 1000
        ? Math.max(10, Math.round(meters / 10) * 10) + "m"
        : (meters / 1000).toFixed(1) + "km";
    const time = walkMinutes < 60
        ? walkMinutes + "分"
        : Math.floor(walkMinutes / 60) + "時間" + (walkMinutes % 60 ? walkMinutes % 60 + "分" : "");

    return "約" + distance + "・徒歩 約" + time;
}

// 近い順に並べる：最初の聖地から、まだ回っていない一番近い聖地へ順に進む
export function orderByNearest(spots) {
    if (spots.length <= 2) {
        return spots.slice();
    }

    const rest = spots.slice(1);
    const ordered = [spots[0]];

    while (rest.length > 0) {
        const last = ordered[ordered.length - 1];
        let best = 0;
        for (let i = 1; i < rest.length; i++) {
            if (distanceMeters(last.coord, rest[i].coord) < distanceMeters(last.coord, rest[best].coord)) {
                best = i;
            }
        }
        ordered.push(rest.splice(best, 1)[0]);
    }

    return ordered;
}

// 作品名→ルート名の順に並べる
export function sortCourses(courses) {
    return courses.slice().sort(function (a, b) {
        return (a.title_name || "").localeCompare(b.title_name || "", "ja") ||
            (a.course_name || "").localeCompare(b.course_name || "", "ja");
    });
}
