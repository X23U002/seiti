// ==========================================
// 獲得したスタンプをDBから読む（スタンプ帳・マイページで共通）
// stamp コレクション：スタンプを取るたびに1件
//   { user_id: user/{ID}への参照, spot_id: spot/{ID}への参照, time_stamp: 取得日時 }
// （書き込みは地図画面の stampsyori.js が行う）
// ==========================================
import {
    collection,
    doc,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db, getCurrentUser } from "./firebase-db.js";
import { getTitleColor, getTitleName } from "./title-colors.js";

// ログイン中のユーザーのID（Firebase Authentication の uid。未ログインなら null）
export async function getLoginUserId() {
    const user = await getCurrentUser();
    return user ? user.uid : null;
}

// 2026年10月13日 の形にする
function formatDate(time) {
    if (!time) return "";
    const date = new Date(Number(time));
    return date.getFullYear() + "年" +
        String(date.getMonth() + 1).padStart(2, "0") + "月" +
        String(date.getDate()).padStart(2, "0") + "日";
}

// 聖地の一覧（DBの spot から作る）
// { total, titles: { 作品名: { count, color } }, spots: [{ id, name, title, info }] }
function buildSpotSummary(spotSnapshot) {
    const summary = { total: 0, titles: {}, spots: [] };

    spotSnapshot.forEach(function (spotDoc) {
        const data = spotDoc.data();
        const title = getTitleName(data);

        if (!summary.titles[title]) {
            summary.titles[title] = { count: 0, color: getTitleColor(title) };
        }
        summary.titles[title].count++;

        summary.spots.push({
            id: spotDoc.id,
            name: data.spot_name || "無題のスポット",
            title: title,
            info: data.spot_info || "",
            season: data.season || 0,
            episode: data.episode || 0
        });
    });

    summary.total = summary.spots.length;

    // 次に開いた時、読み込みが終わるまでの表示に使う
    try {
        localStorage.setItem("seitiSpotSummary", JSON.stringify(
            Object.assign({ updatedAt: Date.now() }, summary)
        ));
    } catch (e) {
        // 保存できない環境では何もしない
    }

    return summary;
}

// スタンプ帳・マイページで使うデータをまとめて読む
// stamps：獲得したスタンプ（スポットごとに1件、初めて取った順）。未ログインなら null
//   { id, name, anime, scene, date, stampedAt, count }
// summary：聖地の一覧（地図を開いていなくても分かる）
export async function loadStampBook() {
    const userId = await getLoginUserId();

    // 聖地の一覧と、このユーザーのスタンプを同時に読む
    const [spotSnapshot, stampSnapshot] = await Promise.all([
        getDocs(collection(db, "spot")),
        userId
            ? getDocs(query(
                collection(db, "stamp"),
                where("user_id", "==", doc(db, "user", userId))
            ))
            : null
    ]);

    const summary = buildSpotSummary(spotSnapshot);
    if (!userId) {
        return { stamps: null, summary: summary };
    }

    const spots = {};
    spotSnapshot.forEach(function (spotDoc) {
        spots[spotDoc.id] = spotDoc.data();
    });

    // スポットID → { 初めて取った時刻, 回数 }
    const bySpot = {};
    stampSnapshot.forEach(function (stampDoc) {
        const data = stampDoc.data();
        const spotId = data.spot_id && data.spot_id.id;
        if (!spotId) return;

        const stampedAt = data.time_stamp && typeof data.time_stamp.toMillis === "function"
            ? data.time_stamp.toMillis()
            : 0;

        const entry = bySpot[spotId] || (bySpot[spotId] = { first: stampedAt, count: 0 });
        entry.first = Math.min(entry.first, stampedAt);
        entry.count += 1;
    });

    const stamps = Object.keys(bySpot)
        .map(function (spotId) {
            const spot = spots[spotId] || {};
            return {
                id: spotId,
                name: spot.spot_name || "無題のスポット",
                anime: getTitleName(spot),
                scene: spot.spot_info || "",
                season: spot.season || 0,
                episode: spot.episode || 0,
                date: formatDate(bySpot[spotId].first),
                stampedAt: bySpot[spotId].first,
                count: bySpot[spotId].count
            };
        })
        .sort(function (a, b) { return a.stampedAt - b.stampedAt; });

    return { stamps: stamps, summary: summary };
}
