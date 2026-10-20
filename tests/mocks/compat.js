// テスト用：Firebase compat 版（地図のスタンプ処理 stampsyori.js が使う）の代わり
// データは firestore.js と同じ localStorage「mockFs」に入れる
// stamp は本番のルールと同じく「作成だけ・4項目・聖地から100m以内」を確かめる
(function () {
    const load = () => JSON.parse(localStorage.getItem("mockFs") || "{}");
    const save = (store) => localStorage.setItem("mockFs", JSON.stringify(store));
    const SERVER_TIME = { __server: true };
    const denied = (why) => Object.assign(new Error("Missing or insufficient permissions. " + why), { code: "permission-denied" });

    class Timestamp {
        constructor(ms) { this.ms = ms; }
        toMillis() { return this.ms; }
        toDate() { return new Date(this.ms); }
    }
    class GeoPoint {
        constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; }
    }

    function distanceMeters(a, b) {
        const r = Math.PI / 180;
        const dLat = (b.latitude - a.latitude) * r;
        const dLng = (b.longitude - a.longitude) * r;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLng / 2) ** 2;
        return 6371000 * 2 * Math.asin(Math.sqrt(h));
    }

    function checkStampRule(data) {
        const keys = Object.keys(data).sort().join(",");
        if (keys !== "position,spot_id,time_stamp,user_id") throw denied("keys=" + keys);
        const uid = JSON.parse(localStorage.getItem("mockAuth") || "{}").current;
        if (!data.user_id || data.user_id.__ref !== "user/" + uid) throw denied("user");
        if (!data.spot_id || !data.spot_id.__ref || data.time_stamp !== SERVER_TIME || !(data.position instanceof GeoPoint)) throw denied("types");
        const spot = (load().spot || {})[data.spot_id.__ref.split("/").pop()];
        if (!spot) throw denied("no spot");
        const distance = distanceMeters(data.position, spot.coord);
        window.__lastStampDistance = distance;
        if (distance > 100) throw denied("too far " + Math.round(distance) + "m");
    }

    function encode(value) {
        if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
        if (value === SERVER_TIME) return { __ts: Date.now() };
        if (value && value.__ref) return { __ref: value.__ref };
        return value;
    }
    function decode(value) {
        if (value && value.__ts !== undefined) return new Timestamp(value.__ts);
        if (value && value.__ref) return ref(value.__ref);
        return value;
    }
    function ref(path) { return { __ref: path, id: path.split("/").pop(), path }; }

    async function create(collectionName, id, data) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (collectionName !== "stamp") throw denied(collectionName);
        checkStampRule(data);
        const store = load();
        const col = store.stamp = store.stamp || {};
        if (col[id]) throw denied("update");
        col[id] = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)]));
        save(store);
    }

    let seq = 0;
    const newId = () => "auto" + Date.now() + "_" + (seq++);
    function docRef(path, id) {
        return Object.assign(ref(path + "/" + id), { set: (data) => create(path, id, data) });
    }
    function colRef(path, filters = []) {
        return {
            doc: (id) => docRef(path, id || newId()),
            async add(data) { const id = newId(); await create(path, id, data); return docRef(path, id); },
            where: (field, _op, value) => colRef(path, filters.concat([[field, value]])),
            async get() {
                if (localStorage.getItem("mockFsHang")) return new Promise(() => {});
                const rows = Object.entries(load()[path] || {})
                    .filter(([, d]) => filters.every(([f, v]) => d[f] && d[f].__ref === v.__ref));
                return {
                    forEach: (fn) => rows.forEach(([id, d]) => fn({
                        id,
                        data: () => Object.fromEntries(Object.entries(d).map(([k, x]) => [k, decode(x)]))
                    }))
                };
            }
        };
    }

    const firestore = () => ({ collection: (name) => colRef(name) });
    firestore.FieldValue = { serverTimestamp: () => SERVER_TIME };
    firestore.Timestamp = { fromMillis: (ms) => new Timestamp(ms) };
    firestore.GeoPoint = GeoPoint;

    const auth = () => ({
        onAuthStateChanged(callback) {
            setTimeout(() => {
                const uid = JSON.parse(localStorage.getItem("mockAuth") || "{}").current;
                callback(uid ? { uid } : null);
            }, 10);
            return () => {};
        }
    });

    window.firebase = { apps: [], initializeApp() { this.apps.push({}); }, firestore, auth };
})();
