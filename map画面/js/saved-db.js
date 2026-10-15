// ==========================================
// お気に入りの聖地・保存したルート（地図と「お気に入り・ルート・履歴」画面で共通）
// favorite コレクション：お気に入り1件につき1件。IDは「ユーザーID_スポットID」
//   { user_id: user/{ID}への参照, spot_id: spot/{ID}への参照, time_stamp: 追加日時 }
// root コレクション：保存したルート1件につき1件
//   { user_id: user/{ID}への参照, save_spot: [スポットID, ...（回る順）], time_stamp: 保存日時 }
// ==========================================
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db, getCurrentUser } from "./firebase-db.js";

// ログイン中のユーザーのID（未ログインなら null）
export async function getSavedUserId() {
    const user = await getCurrentUser();
    return user ? user.uid : null;
}

function toMillis(time) {
    return time && typeof time.toMillis === "function" ? time.toMillis() : 0;
}

// 自分のドキュメントだけを読む
async function readMine(collectionName, userId) {
    return getDocs(query(
        collection(db, collectionName),
        where("user_id", "==", doc(db, "user", userId))
    ));
}

// ---------- お気に入り ----------

// お気に入りの聖地（新しい順）。未ログインなら null
// [{ spotId, addedAt }]
export async function loadFavorites() {
    const userId = await getSavedUserId();
    if (!userId) return null;

    const snapshot = await readMine("favorite", userId);
    const list = [];
    snapshot.forEach(function (favoriteDoc) {
        const data = favoriteDoc.data();
        if (data.spot_id && data.spot_id.id) {
            list.push({ spotId: data.spot_id.id, addedAt: toMillis(data.time_stamp) });
        }
    });

    return list.sort(function (a, b) { return b.addedAt - a.addedAt; });
}

// お気に入りに入れる（on = true）／外す（on = false）
export async function setFavorite(spotId, on) {
    const userId = await getSavedUserId();
    if (!userId) throw new Error("not-signed-in");

    const ref = doc(db, "favorite", userId + "_" + spotId);

    if (on) {
        await setDoc(ref, {
            user_id: doc(db, "user", userId),
            spot_id: doc(db, "spot", String(spotId)),
            time_stamp: serverTimestamp()
        });
    } else {
        await deleteDoc(ref);
    }
}

// ---------- 保存したルート ----------

// ルートを保存する（spotIds は回る順のスポットID）
export async function saveRoute(spotIds) {
    const userId = await getSavedUserId();
    if (!userId) throw new Error("not-signed-in");

    const ref = await addDoc(collection(db, "root"), {
        user_id: doc(db, "user", userId),
        save_spot: spotIds.map(String),
        time_stamp: serverTimestamp()
    });

    return ref.id;
}

// 保存したルート（新しい順）。未ログインなら null
// [{ id, spotIds, savedAt }]
export async function loadSavedRoutes() {
    const userId = await getSavedUserId();
    if (!userId) return null;

    const snapshot = await readMine("root", userId);
    const list = [];
    snapshot.forEach(function (routeDoc) {
        const data = routeDoc.data();
        list.push({
            id: routeDoc.id,
            spotIds: Array.isArray(data.save_spot) ? data.save_spot.map(String) : [],
            savedAt: toMillis(data.time_stamp)
        });
    });

    return list.sort(function (a, b) { return b.savedAt - a.savedAt; });
}

export async function deleteSavedRoute(routeId) {
    await deleteDoc(doc(db, "root", routeId));
}
