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

import { db } from "./firebase-db.js";

// ログイン中のユーザーID（未ログインなら null）
export function getLoginUserId() {
    try {
        return sessionStorage.getItem("userId") ||
            localStorage.getItem("seitiCurrentUserId") ||
            null;
    } catch (e) {
        return null;
    }
}

// 2026年10月13日 の形にする
function formatDate(time) {
    if (!time) return "";
    const date = new Date(Number(time));
    return date.getFullYear() + "年" +
        String(date.getMonth() + 1).padStart(2, "0") + "月" +
        String(date.getDate()).padStart(2, "0") + "日";
}

// 獲得したスタンプの一覧（スポットごとに1件、初めて取った順）。未ログインなら null を返す
// { id, name, anime, scene, date, stampedAt, count }
export async function loadMyStamps() {
    const userId = getLoginUserId();
    if (!userId) return null;

    // このユーザーのスタンプと、名前を出すための聖地の一覧を同時に読む
    const [stampSnapshot, spotSnapshot] = await Promise.all([
        getDocs(query(
            collection(db, "stamp"),
            where("user_id", "==", doc(db, "user", userId))
        )),
        getDocs(collection(db, "spot"))
    ]);

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

    return Object.keys(bySpot)
        .map(function (spotId) {
            const spot = spots[spotId] || {};
            return {
                id: spotId,
                name: spot.spot_name || "無題のスポット",
                anime: spot.title_name || "作品名不明",
                scene: spot.spot_info || "",
                date: formatDate(bySpot[spotId].first),
                stampedAt: bySpot[spotId].first,
                count: bySpot[spotId].count
            };
        })
        .sort(function (a, b) { return a.stampedAt - b.stampedAt; });
}
