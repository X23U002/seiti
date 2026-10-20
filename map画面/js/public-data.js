// ==========================================
// 作品一覧・作品ページで使うデータ（聖地・おすすめルート・自分のスタンプ）
// 聖地とおすすめルートは誰でも読める。広告ブロックなどで Firestore の通信が止められても
// 読めるよう、時間内に読めなければ Firestore の Web API から読む（地図画面と同じ考え方）。
// 聖地は地図画面が端末に記録した一覧（seitiSpotCache）があれば、先にそれを使える
// ==========================================
import {
    collection,
    doc,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db, getCurrentUser } from "./firebase-db.js";
import { COURSE_COLLECTION, sortCourses } from "./course.js";

const FIRESTORE_TIMEOUT_MS = 8000;
const REST_URL = "https://firestore.googleapis.com/v1/projects/sisukai-121cf/databases/(default)/documents/";
const SPOT_CACHE_KEY = "seitiSpotCache";

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise(function (resolve, reject) {
            setTimeout(function () {
                reject(new Error(ms / 1000 + "秒以内に読み込めませんでした"));
            }, ms);
        })
    ]);
}

function fromRestValue(value) {
    if (!value || typeof value !== "object") return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("booleanValue" in value) return value.booleanValue;
    if ("geoPointValue" in value) {
        return {
            latitude: Number(value.geoPointValue.latitude || 0),
            longitude: Number(value.geoPointValue.longitude || 0)
        };
    }
    if ("timestampValue" in value) return value.timestampValue;
    if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromRestValue);
    return null;
}

async function fetchFromRest(collectionName) {
    const list = [];
    let pageToken = "";

    do {
        const response = await fetch(
            REST_URL + collectionName + "?pageSize=300" +
            (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "")
        );
        if (!response.ok) throw new Error("Web API から読めませんでした: " + response.status);

        const json = await response.json();
        (json.documents || []).forEach(function (document) {
            const data = { id: document.name.split("/").pop() };
            Object.keys(document.fields || {}).forEach(function (key) {
                data[key] = fromRestValue(document.fields[key]);
            });
            list.push(data);
        });
        pageToken = json.nextPageToken || "";
    } while (pageToken);

    return list;
}

async function fetchFromFirestore(collectionName) {
    const snapshot = await getDocs(collection(db, collectionName));
    const list = [];
    snapshot.forEach(function (docSnap) {
        list.push(Object.assign({ id: docSnap.id }, docSnap.data()));
    });
    return list;
}

// Firestore（8秒まで）→ だめなら Web API
async function fetchCollection(collectionName) {
    try {
        return await withTimeout(fetchFromFirestore(collectionName), FIRESTORE_TIMEOUT_MS);
    } catch (error) {
        console.warn(collectionName + " を Firestore から読めなかったので、Web API から読みます:", error);
        return fetchFromRest(collectionName);
    }
}

// 位置は { latitude, longitude } にそろえ、位置が無い聖地は除く
function normalizeSpots(list) {
    return list
        .filter(function (spot) { return spot.coord; })
        .map(function (spot) {
            return Object.assign({}, spot, {
                coord: {
                    latitude: Number(spot.coord.latitude),
                    longitude: Number(spot.coord.longitude)
                }
            });
        });
}

// 地図画面が前に記録した聖地（無ければ null）
export function readCachedSpots() {
    try {
        const list = JSON.parse(localStorage.getItem(SPOT_CACHE_KEY) || "null");
        return Array.isArray(list) ? list : null;
    } catch (error) {
        return null;
    }
}

export async function loadSpots() {
    const list = normalizeSpots(await fetchCollection("spot"));
    try {
        localStorage.setItem(SPOT_CACHE_KEY, JSON.stringify(list));
    } catch (error) {
        // 保存できない環境では何もしない
    }
    return list;
}

export async function loadCourses() {
    const list = await fetchCollection(COURSE_COLLECTION);
    return sortCourses(list.filter(function (course) {
        return Array.isArray(course.spot_ids) && course.spot_ids.length > 0;
    }));
}

// ログイン中の人が、どの聖地で何回スタンプを取ったか（スポットID → 回数）。未ログインなら null
export async function loadMyStampCounts() {
    const user = await getCurrentUser();
    if (!user) return null;

    const snapshot = await withTimeout(
        getDocs(query(collection(db, "stamp"), where("user_id", "==", doc(db, "user", user.uid)))),
        FIRESTORE_TIMEOUT_MS
    );

    const counts = {};
    snapshot.forEach(function (stampDoc) {
        const spotId = stampDoc.data().spot_id && stampDoc.data().spot_id.id;
        if (spotId) counts[spotId] = (counts[spotId] || 0) + 1;
    });
    return counts;
}
