// ==========================================
// Firestore の読み込み（地図以外の画面で共通）
// 広告ブロックなどで Firestore の通信（…/channel）が止められると、読み込みが終わらなくなる。
// そこで、時間内に読めなければ Firestore の Web API（ふつうの fetch）から読む。
// ・誰でも読めるもの（聖地・おすすめルート）：そのまま読む
// ・自分のもの（スタンプ・お気に入り・保存したルート・お知らせ・自分の user）：
//   ログイン中の人の ID トークンを付けて読む（Firestore のルールはそのまま効く）
// 聖地は地図画面が端末に記録した一覧（seitiSpotCache）があれば、先にそれを使える
// ==========================================
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db, getCurrentUser } from "./firebase-db.js?v=917161b9";
import { COURSE_COLLECTION, sortCourses } from "./course.js?v=5729311e";

const FIRESTORE_TIMEOUT_MS = 8000;
const DATABASE_PATH = "projects/sisukai-121cf/databases/(default)/documents";
const REST_URL = "https://firestore.googleapis.com/v1/" + DATABASE_PATH + "/";
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

// ---------- 自分のもの（ID トークンを付けて読む） ----------

// Web API の日時・参照を、Firestore の読み込み結果と同じように使える形にする
function toTimestampLike(iso) {
    const ms = Date.parse(iso);
    return {
        seconds: Math.floor(ms / 1000),
        toMillis: function () { return ms; },
        toDate: function () { return new Date(ms); }
    };
}

function fromRestValueRich(value) {
    if (value && typeof value === "object") {
        if ("referenceValue" in value) {
            return { id: value.referenceValue.split("/").pop(), path: value.referenceValue };
        }
        if ("timestampValue" in value) return toTimestampLike(value.timestampValue);
        if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromRestValueRich);
    }
    return fromRestValue(value);
}

function restFields(fields) {
    const data = {};
    Object.keys(fields || {}).forEach(function (key) {
        data[key] = fromRestValueRich(fields[key]);
    });
    return data;
}

// { id, data() } の形（Firestore の読み込み結果の doc と同じように使える）
function toDocLike(id, data) {
    return { id: id, data: function () { return data; } };
}

async function authHeaders() {
    const user = await getCurrentUser();
    if (!user) throw Object.assign(new Error("ログインしていません"), { code: "not-logged-in" });
    return {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + await user.getIdToken()
    };
}

function restError(response) {
    return Object.assign(
        new Error("Web API から読めませんでした: " + response.status),
        { code: response.status === 403 ? "permission-denied" : "unavailable" }
    );
}

// collectionName のうち、user_id が自分のものを読む。[{ id, data() }]
export async function queryMine(collectionName) {
    const user = await getCurrentUser();
    if (!user) return [];

    try {
        const snapshot = await withTimeout(
            getDocs(query(collection(db, collectionName), where("user_id", "==", doc(db, "user", user.uid)))),
            FIRESTORE_TIMEOUT_MS
        );
        const list = [];
        snapshot.forEach(function (d) { list.push(toDocLike(d.id, d.data())); });
        return list;
    } catch (error) {
        if (error && error.code === "permission-denied") throw error;
        console.warn(collectionName + " を Firestore から読めなかったので、Web API から読みます:", error);
    }

    const response = await fetch(REST_URL.replace(/\/$/, "") + ":runQuery", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: collectionName }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: "user_id" },
                        op: "EQUAL",
                        value: { referenceValue: DATABASE_PATH + "/user/" + user.uid }
                    }
                }
            }
        })
    });
    if (!response.ok) throw restError(response);

    return (await response.json())
        .filter(function (row) { return row.document; })
        .map(function (row) {
            return toDocLike(row.document.name.split("/").pop(), restFields(row.document.fields));
        });
}

// 1件だけ読む（自分の user・自分の admin など）。無ければ null、あれば項目
export async function getOneDoc(collectionName, docId) {
    try {
        const snapshot = await withTimeout(getDoc(doc(db, collectionName, docId)), FIRESTORE_TIMEOUT_MS);
        return snapshot.exists() ? snapshot.data() : null;
    } catch (error) {
        if (error && error.code === "permission-denied") throw error;
        console.warn(collectionName + "/" + docId + " を Firestore から読めなかったので、Web API から読みます:", error);
    }

    const response = await fetch(REST_URL + collectionName + "/" + encodeURIComponent(docId), {
        headers: await authHeaders()
    });
    if (response.status === 404) return null;
    if (!response.ok) throw restError(response);
    return restFields((await response.json()).fields);
}

// ---------- 誰でも読めるもの ----------

// Firestore（8秒まで）→ だめなら Web API。[{ id, ...項目 }]
export async function fetchCollection(collectionName) {
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

    const counts = {};
    (await queryMine("stamp")).forEach(function (stampDoc) {
        const spotId = stampDoc.data().spot_id && stampDoc.data().spot_id.id;
        if (spotId) counts[spotId] = (counts[spotId] || 0) + 1;
    });
    return counts;
}
