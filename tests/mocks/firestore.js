// テスト用：firebase-firestore.js（モジュール版）の代わり
// データはブラウザの localStorage「mockFs」に入れる
//   mockFs = { コレクション名: { ドキュメントID: 項目 } }
//   参照は { __ref: "user/uid1" }、日時は { __ts: ミリ秒 }、位置は { latitude, longitude } で保存する
// 本番のセキュリティルールのうち、アプリの書き込みが守るべきこと
// （項目の名前・自分のものだけ・管理者だけ）もここで確かめる
// localStorage「mockFsHang」があると読み込みが終わらない（広告ブロックで通信が止められた時の再現）

const load = () => JSON.parse(localStorage.getItem("mockFs") || "{}");
const save = (store) => localStorage.setItem("mockFs", JSON.stringify(store));
const me = () => JSON.parse(localStorage.getItem("mockAuth") || "{}").current || null;
const isAdmin = () => { const uid = me(); return !!(uid && (load().admin || {})[uid]); };
const hangs = () => !!localStorage.getItem("mockFsHang");
const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
const denied = (why) => Object.assign(new Error("Missing or insufficient permissions. " + why), { code: "permission-denied" });

const SERVER_TIME = { __server: true };

class Timestamp {
    constructor(ms) { this.ms = ms; }
    toMillis() { return this.ms; }
    toDate() { return new Date(this.ms); }
}

export class GeoPoint {
    constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; }
}

export function getFirestore() { return {}; }
export function serverTimestamp() { return SERVER_TIME; }
export function collection(_db, ...path) { return { path: path.join("/") }; }
export function where(field, _op, value) { return { field, value }; }
export function query(col, ...filters) { return { path: col.path, filters }; }

export function doc(parent, ...path) {
    // doc(collection(...)) は自動のIDを付ける
    const full = parent && parent.path && path.length === 0
        ? parent.path + "/auto" + Math.random().toString(36).slice(2, 10)
        : path.join("/");
    return { __ref: full, path: full, id: full.split("/").pop() };
}

// ---------- 保存の形 ----------

function encode(value) {
    if (value === SERVER_TIME) return { __ts: Date.now() };
    if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
    if (value && value.__ref) return { __ref: value.__ref };
    if (Array.isArray(value)) return value.map(encode);
    return value;
}

function decode(value) {
    if (value && value.__ts !== undefined) return new Timestamp(value.__ts);
    if (value && value.__ref) return { id: value.__ref.split("/").pop(), path: value.__ref };
    if (Array.isArray(value)) return value.map(decode);
    return value;
}

const mapValues = (data, fn) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fn(v)]));

function snapshot(id, data) {
    return { id, exists: () => !!data, data: () => (data ? mapValues(data, decode) : undefined) };
}

// ---------- ルール ----------

function hasKeys(data, required, optional = []) {
    const keys = Object.keys(data);
    return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

const isMine = (data) => !!me() && data.user_id && data.user_id.__ref === "user/" + me();
const isCount = (value, max) => value === undefined || (Number.isInteger(value) && value >= 0 && value <= max);

function spotOk(data) {
    return hasKeys(data, ["coord", "geo_hash", "image_url", "spot_info", "spot_name", "title_name", "title_url"], ["season", "episode"]) &&
        isCount(data.season, 99) && isCount(data.episode, 999);
}

function courseOk(data) {
    return hasKeys(data, ["course_name", "description", "spot_ids", "title_name", "updated_at"]) &&
        data.updated_at === SERVER_TIME && Array.isArray(data.spot_ids) &&
        data.spot_ids.length >= 2 && data.spot_ids.length <= 30 &&
        !!data.course_name && data.course_name.length <= 50 && data.description.length <= 500;
}

// 新しく作る時
const CREATE_RULES = {
    request_spot: (d) => isMine(d) && d.request_state === "申請中" &&
        hasKeys(d, ["user_id", "request_title", "image_url", "request_info", "request_state"], ["coord"]) &&
        (d.coord === undefined || d.coord instanceof GeoPoint),
    contact: (d) => isMine(d) && d.contact_state === "未対応" &&
        hasKeys(d, ["user_id", "contact_info", "contact_state", "image_url"]),
    root: (d) => isMine(d) && hasKeys(d, ["user_id", "save_spot", "time_stamp"]) &&
        Array.isArray(d.save_spot) && d.time_stamp === SERVER_TIME,
    favorite: (d, id) => isMine(d) && hasKeys(d, ["user_id", "spot_id", "time_stamp"]) &&
        id === me() + "_" + d.spot_id.__ref.split("/").pop() && d.time_stamp === SERVER_TIME,
    user: (_d, id) => id === me(),
    message: (d) => isAdmin() && hasKeys(d, ["user_id", "title", "body", "is_read", "created_at"]) &&
        d.is_read === false && d.created_at === SERVER_TIME,
    spot: (d) => isAdmin() && spotOk(d),
    course: (d) => isAdmin() && courseOk(d)
};

// 書きかえ・削除（管理者か、自分のものだけ）
function canChange(collectionName, id, current) {
    if (isAdmin()) return true;
    if (collectionName === "user") return id === me();
    return !!current && isMine(current);
}

function applyCreate(store, collectionName, id, data) {
    const rule = CREATE_RULES[collectionName];
    if (!rule || !rule(data, id)) throw denied("create " + collectionName + " " + Object.keys(data).sort().join(","));
    (store[collectionName] = store[collectionName] || {})[id] = mapValues(data, encode);
}

function applyUpdate(store, collectionName, id, data) {
    const current = (store[collectionName] || {})[id];
    if (!current) throw Object.assign(new Error("No document to update: " + collectionName + "/" + id), { code: "not-found" });
    if (!canChange(collectionName, id, current)) throw denied("update " + collectionName);
    const merged = Object.assign({}, current, mapValues(data, encode));
    if (collectionName === "spot" && !spotOk(merged)) throw denied("spot " + Object.keys(merged).sort().join(","));
    if (collectionName === "course" && !courseOk(data)) throw denied("course " + Object.keys(data).sort().join(","));
    store[collectionName][id] = merged;
}

function applyDelete(store, collectionName, id) {
    const current = (store[collectionName] || {})[id];
    if (!current) return;
    if (!canChange(collectionName, id, current)) throw denied("delete " + collectionName);
    delete store[collectionName][id];
}

const split = (ref) => { const parts = ref.__ref.split("/"); return [parts[0], parts[1]]; };

// ---------- 読み込み ----------

export async function getDocs(ref) {
    if (hangs()) return new Promise(() => {});
    await wait();
    const filters = ref.filters || [];
    const ownQuery = filters.some((f) => f.field === "user_id" && me() && f.value.__ref === "user/" + me());
    if (["request_spot", "contact"].includes(ref.path) && !ownQuery && !isAdmin()) throw denied("read " + ref.path);

    const rows = Object.entries(load()[ref.path] || {})
        .filter(([, d]) => filters.every((f) => d[f.field] && d[f.field].__ref === f.value.__ref));
    return { forEach: (fn) => rows.forEach(([id, d]) => fn(snapshot(id, d))) };
}

export async function getDoc(ref) {
    if (hangs()) return new Promise(() => {});
    await wait();
    const [collectionName, id] = split(ref);
    return snapshot(id, (load()[collectionName] || {})[id]);
}

// ---------- 書き込み ----------

export async function addDoc(col, data) {
    await wait();
    const id = "auto" + Date.now() + Math.random().toString(36).slice(2, 6);
    const store = load();
    applyCreate(store, col.path, id, data);
    save(store);
    return { id };
}

export async function setDoc(ref, data) {
    await wait();
    const [collectionName, id] = split(ref);
    const store = load();
    if ((store[collectionName] || {})[id]) applyUpdate(store, collectionName, id, data);
    else applyCreate(store, collectionName, id, data);
    save(store);
}

export async function updateDoc(ref, data) {
    await wait();
    const store = load();
    applyUpdate(store, ...split(ref), data);
    save(store);
}

export async function deleteDoc(ref) {
    await wait();
    const store = load();
    applyDelete(store, ...split(ref));
    save(store);
}

// まとめて書く（途中で失敗したら何も書かない）
export function writeBatch() {
    const ops = [];
    return {
        set(ref, data) { ops.push((store) => applyCreate(store, ...split(ref), data)); },
        update(ref, data) { ops.push((store) => applyUpdate(store, ...split(ref), data)); },
        delete(ref) { ops.push((store) => applyDelete(store, ...split(ref))); },
        async commit() {
            await wait();
            const store = load();
            ops.forEach((op) => op(store));
            save(store);
        }
    };
}
