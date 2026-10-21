// 受け付け（サイトの確認・ログイン・回数制限・エラー）のテスト。通信する部品は差しかえる
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlanError, createHandler } from "../src/index.js";

const ORIGIN = "https://x23u002.github.io";
const env = { ALLOWED_ORIGINS: ORIGIN + ",http://localhost:8765", DAILY_LIMIT: "2", FIREBASE_PROJECT_ID: "p" };
const SPOTS = [
    { id: "a", spot_name: "駅", coord: { latitude: 34.9, longitude: 135.8 } },
    { id: "b", spot_name: "橋", coord: { latitude: 34.895, longitude: 135.8 } }
];
const ANSWER = { plan_title: "t", summary: "s", stops: [{ spot_id: "a", stay_minutes: 10, comment: "" }, { spot_id: "b", stay_minutes: 10, comment: "" }] };

function setup(overrides = {}) {
    const counts = new Map();
    const calls = { gemini: 0 };
    const deps = Object.assign({
        verifyFirebaseToken: async (token) => { if (token !== "good") throw new Error("bad"); return "uid1"; },
        fetchSpots: async () => SPOTS,
        askGemini: async () => { calls.gemini++; return ANSWER; },
        usage: {
            count: async (uid) => counts.get(uid) || 0,
            add: async (uid, _env, _now, current) => { counts.set(uid, current + 1); }
        },
        now: () => 0
    }, overrides);
    return { handle: createHandler(deps), calls, counts };
}

const request = (body, { origin = ORIGIN, token = "good", method = "POST", path = "/plan" } = {}) =>
    new Request("https://worker.example" + path, {
        method,
        headers: Object.assign({ "Content-Type": "application/json" }, origin ? { Origin: origin } : {}, token ? { Authorization: "Bearer " + token } : {}),
        body: method === "POST" ? JSON.stringify(body) : undefined
    });

test("ログインした人が作品を送ると、プランと今日の残り回数が返る", async () => {
    const { handle } = setup();
    const response = await handle(request({ title: "作品" }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    const body = await response.json();
    assert.deepEqual(body.plan.stops.map((stop) => stop.id), ["a", "b"]);
    assert.equal(body.remaining, 1);
});

test("決めたサイト以外からは受けない", async () => {
    const { handle, calls } = setup();
    const response = await handle(request({ title: "作品" }, { origin: "https://evil.example" }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(calls.gemini, 0);
});

test("ブラウザの事前確認（OPTIONS）に答える", async () => {
    const { handle } = setup();
    const response = await handle(request(null, { method: "OPTIONS", token: null }), env);
    assert.equal(response.status, 204);
    assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/);
});

test("ログインの証明が無い・偽物なら断る", async () => {
    const { handle, calls } = setup();
    assert.equal((await handle(request({ title: "作品" }, { token: null }), env)).status, 401);
    assert.equal((await handle(request({ title: "作品" }, { token: "fake" }), env)).status, 401);
    assert.equal(calls.gemini, 0);
});

test("1日の回数を超えたら断り、AI は呼ばない", async () => {
    const { handle, calls } = setup();
    assert.equal((await handle(request({ title: "作品" }), env)).status, 200);
    assert.equal((await handle(request({ title: "作品" }), env)).status, 200);
    const third = await handle(request({ title: "作品" }), env);
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error, "limit");
    assert.equal(calls.gemini, 2);
});

test("作品の指定が無い・聖地が無い時", async () => {
    const { handle } = setup({ fetchSpots: async () => [] });
    assert.equal((await handle(request({}), env)).status, 400);
    assert.equal((await handle(request({ title: "x".repeat(101) }), env)).status, 400);
    assert.equal((await handle(request({ title: "ない作品" }), env)).status, 404);
});

test("AI の答えが使えない時は 502、AI が混んでいる時は 503（どちらも回数は数える）", async () => {
    const bad = setup({ askGemini: async () => ({ stops: [{ spot_id: "zzz" }] }) });
    assert.equal((await bad.handle(request({ title: "作品" }), env)).status, 502);
    assert.equal(bad.counts.get("uid1"), 1);

    const busy = setup({ askGemini: async () => { throw new PlanError("busy"); } });
    const response = await busy.handle(request({ title: "作品" }), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "busy");
    assert.equal(busy.counts.get("uid1"), 1);
});

test("/plan 以外・POST 以外は 404", async () => {
    const { handle } = setup();
    assert.equal((await handle(request({ title: "作品" }, { path: "/other" }), env)).status, 404);
    assert.equal((await handle(request(null, { method: "GET" }), env)).status, 404);
});
