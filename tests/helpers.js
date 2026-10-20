// テストの共通部分
// ・外部（Firebase・Mapbox）への通信をすべて、tests/mocks と node_modules の中身に差しかえる
// ・Firestore のデータは seed() でブラウザの localStorage に入れる（mocks/firestore.js が読む）
// ・Web API（Firestore REST）で読まれた時も、seed() と同じデータを返す
// ・ページで起きたエラーを集めて、テストの最後に「エラーなし」を確かめる
import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(file);
const mapboxDist = path.dirname(require.resolve("mapbox-gl/dist/mapbox-gl.js"));

export const SPOTS = JSON.parse(fs.readFileSync(path.join(here, "fixtures/spots.json"), "utf8"));
export const spotNamed = (name) => SPOTS.find((spot) => spot.spot_name === name);

// 聖地だけ入ったデータ（{ spot: { ID: 項目 } }）に other を足す
export function withSpots(other = {}) {
    const spot = {};
    SPOTS.forEach(({ id, ...data }) => { spot[id] = data; });
    return Object.assign({ spot }, other);
}

// 何もない背景だけの地図スタイル（地図の画像は読まない）
const STYLE = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e3ece4" } }] };

// 地図の検索（Mapbox Search Box API）の答え：いつも「京都駅」が1件見つかる
export const SEARCH_PLACE = { name: "京都駅", lng: 135.7588, lat: 34.9858 };
const SEARCH_SUGGEST = {
    suggestions: [{ mapbox_id: "test-kyoto-station", name: SEARCH_PLACE.name, full_address: "京都府京都市下京区東塩小路町" }]
};
const SEARCH_RETRIEVE = {
    features: [{ geometry: { type: "Point", coordinates: [SEARCH_PLACE.lng, SEARCH_PLACE.lat] }, properties: { name: SEARCH_PLACE.name } }]
};

const DOCUMENTS = "projects/sisukai-121cf/databases/(default)/documents/";

// mockFs の値 → Firestore REST の値
function restValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === "boolean") return { booleanValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } };
    if (value.__ref) return { referenceValue: DOCUMENTS + value.__ref };
    if (value.__ts !== undefined) return { timestampValue: new Date(value.__ts).toISOString() };
    if ("latitude" in value) return { geoPointValue: value };
    return { stringValue: String(value) };
}

function restDocument(collectionName, id, data) {
    return {
        name: DOCUMENTS + collectionName + "/" + id,
        fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, restValue(value)]))
    };
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const script = (route, body) => route.fulfill({ status: 200, contentType: "application/javascript", body });
const css = (route, body) => route.fulfill({ status: 200, contentType: "text/css", body });

// Firestore REST（Web API）の代わり。data は seed() で入れたもの
function answerRest(route, data, restCalls) {
    const request = route.request();
    const url = new URL(request.url());
    const docPath = decodeURIComponent(url.pathname.split("/documents")[1] || "");
    restCalls.push(request.method() + " " + docPath + (request.headers().authorization ? " +token" : ""));

    if (docPath === ":runQuery") {
        const query = JSON.parse(request.postData()).structuredQuery;
        const collectionName = query.from[0].collectionId;
        const owner = query.where.fieldFilter.value.referenceValue.split("/documents/")[1];
        const rows = Object.entries(data[collectionName] || {})
            .filter(([, d]) => d.user_id && d.user_id.__ref === owner)
            .map(([id, d]) => ({ document: restDocument(collectionName, id, d) }));
        return json(route, rows.length ? rows : [{ readTime: new Date().toISOString() }]);
    }

    const [collectionName, id] = docPath.split("/").filter(Boolean);
    if (id) {
        const d = (data[collectionName] || {})[id];
        return d ? json(route, restDocument(collectionName, id, d)) : json(route, {}, 404);
    }
    return json(route, {
        documents: Object.entries(data[collectionName] || {}).map(([docId, d]) => restDocument(collectionName, docId, d))
    });
}

export const test = base.extend({
    // REST で読まれた回数（「METHOD パス +token」の一覧）
    restCalls: async ({}, use) => { await use([]); },

    page: async ({ page, restCalls }, use) => {
        const state = { data: withSpots() };
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));

        // 地図（mapboxgl.Map）を window.__map から触れるようにする
        await page.addInitScript(() => {
            let mapbox;
            Object.defineProperty(window, "mapboxgl", {
                configurable: true,
                get() { return mapbox; },
                set(value) {
                    mapbox = value;
                    if (value && value.Map && !value.Map.__wrapped) {
                        const Original = value.Map;
                        value.Map = class extends Original {
                            constructor(options) { super(options); window.__map = this; }
                        };
                        value.Map.__wrapped = true;
                    }
                }
            });
        });

        await page.route(/^https:\/\//, (route) => {
            const url = route.request().url();
            if (url.endsWith("firebase-app-compat.js")) return script(route, read(path.join(here, "mocks/compat.js")));
            if (url.endsWith("-compat.js")) return script(route, "");
            if (url.endsWith("firebase-app.js")) return script(route, "export function initializeApp(){return {}} export function getApp(){return {}}");
            if (url.endsWith("firebase-auth.js")) return script(route, read(path.join(here, "mocks/auth.js")));
            if (url.endsWith("firebase-firestore.js")) return script(route, read(path.join(here, "mocks/firestore.js")));
            if (url.endsWith("firebase-analytics.js")) return script(route, "export function getAnalytics(){return {}}");
            if (url.startsWith("https://firestore.googleapis.com/v1/")) return answerRest(route, state.data, restCalls);
            if (url.includes("mapbox-gl.js")) return script(route, read(path.join(mapboxDist, "mapbox-gl.js")));
            if (url.includes("mapbox-gl.css")) return css(route, read(path.join(mapboxDist, "mapbox-gl.css")));
            if (url.includes("/styles/v1/")) return json(route, STYLE);
            if (url.includes("/geocoding/v5/")) return json(route, { features: [{ center: [135.8063, 34.8930], place_name: "宇治橋" }] });
            if (url.includes("/search/searchbox/v1/suggest")) return json(route, SEARCH_SUGGEST);
            if (url.includes("/search/searchbox/v1/retrieve/")) return json(route, SEARCH_RETRIEVE);
            return route.fulfill({ status: 404, body: "" });
        });

        page.__state = state;
        await use(page);
        expect(errors, "ページでエラーが起きていないこと").toEqual([]);
    }
});

export { expect };

// Firestore のデータとログイン状態を入れる（最初のページを開く前に呼ぶ）
// data：{ コレクション名: { ID: 項目 } }（聖地は withSpots() で足す）
// user：ログイン中にする uid（null なら未ログイン）
// users：ログインできるアカウント { メール: { uid, password } }
// local：そのほかに入れておく localStorage の値
export async function seed(page, { data = withSpots(), user = null, users = {}, local = {} } = {}) {
    page.__state.data = data;
    await page.goto("html/guide.html");
    await page.evaluate(([fsData, auth, extra]) => {
        localStorage.clear();
        localStorage.setItem("mockFs", JSON.stringify(fsData));
        localStorage.setItem("mockAuth", JSON.stringify(auth));
        Object.entries(extra).forEach(([key, value]) => localStorage.setItem(key, value));
    }, [data, { users, current: user }, local]);
}

// ブラウザの中の Firestore のデータ（mockFs）
export const readStore = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mockFs") || "{}"));

// ログイン中の利用者を変える
export const switchUser = (page, uid) => page.evaluate((id) => {
    const auth = JSON.parse(localStorage.getItem("mockAuth"));
    auth.current = id;
    localStorage.setItem("mockAuth", JSON.stringify(auth));
}, uid);

export const PROFILE = (name, mail) => ({ user_name: name, mail_address: mail, icon_image_url: "no_image" });
