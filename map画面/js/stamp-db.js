// ==========================================
// 獲得したスタンプをDBから読む（スタンプ帳・マイページで共通）
// 保存先：user/{ログイン中のユーザーID}/stamps/{スポットID}
// （書き込みは地図画面の stampsyori.js が行う）
// ==========================================
import {
    collection,
    getDocs
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

// 獲得したスタンプの一覧（古い順）。未ログインなら null を返す
// { id, name, anime, scene, date, stampedAt }
export async function loadMyStamps() {
    const userId = getLoginUserId();
    if (!userId) return null;

    const snapshot = await getDocs(collection(db, "user", userId, "stamps"));
    const stamps = [];

    snapshot.forEach(function (stampDoc) {
        const data = stampDoc.data();
        const stampedAt = Number(data.first_stamped_at) || 0;
        stamps.push({
            id: data.spot_id || stampDoc.id,
            name: data.spot_name || "無題のスポット",
            anime: data.title_name || "作品名不明",
            scene: data.spot_info || "",
            date: formatDate(stampedAt),
            stampedAt: stampedAt
        });
    });

    stamps.sort(function (a, b) { return a.stampedAt - b.stampedAt; });
    return stamps;
}
