// 受け付け（サイトの確認・ログイン・回数制限・エラー）のテスト。通信する部品は差しかえる
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlanError, RETRY_WAIT, createHandler, defaultDeps } from "../src/index.js";

RETRY_WAIT.ms = 0;

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
            add: async (uid, _env, _now, current) => { counts.set(uid, current + 1); },
            set: async (uid, _env, _now, value) => { counts.set(uid, value); }
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

test("AI の答えが使えない時は 502（無料枠を使ったので回数は数える）", async () => {
    const bad = setup({ askGemini: async () => ({ stops: [{ spot_id: "zzz" }] }) });
    const badResponse = await bad.handle(request({ title: "作品" }), env);
    assert.equal(badResponse.status, 502);
    assert.match((await badResponse.json()).detail, /2か所以上/);
    assert.equal(bad.counts.get("uid1"), 1);
});

test("/plan 以外・POST 以外は 404", async () => {
    const { handle } = setup();
    assert.equal((await handle(request({ title: "作品" }, { path: "/other" }), env)).status, 404);
    assert.equal((await handle(request(null, { method: "GET" }), env)).status, 404);
});

test("Gemini が断った時は、その理由を detail に入れて返す", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 404, message: "models/xxx is not found" } }), { status: 404 });
    try {
        const { defaultDeps } = await import("../src/index.js");
        const { handle, counts } = setup({ askGemini: defaultDeps.askGemini });
        const response = await handle(request({ title: "作品" }), Object.assign({ GEMINI_API_KEY: "k" }, env));
        assert.equal(response.status, 502);
        assert.equal((await response.json()).detail, "Gemini 404（gemini-flash-latest）: models/xxx is not found");
        // こちらの設定の問題なので、今日の回数には数えない
        assert.equal(counts.get("uid1"), 0);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("Gemini の答えが読めない時も、理由を detail に入れて返す", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{\"plan" }] } }] }), { status: 200 });
    try {
        const { defaultDeps } = await import("../src/index.js");
        const { handle } = setup({ askGemini: defaultDeps.askGemini });
        const response = await handle(request({ title: "作品" }), Object.assign({ GEMINI_API_KEY: "k" }, env));
        assert.equal(response.status, 502);
        assert.match((await response.json()).detail, /MAX_TOKENS/);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("Gemini に届かなかった時（通信の失敗）も、今日の回数に数えない", async () => {
    const { handle, counts } = setup({ askGemini: async () => { throw new TypeError("fetch failed"); } });
    const response = await handle(request({ title: "作品" }), env);
    assert.equal(response.status, 502);
    assert.equal(counts.get("uid1"), 0);
});

// ---------- 混んでいる時の手当て（Gemini への通信を差しかえる） ----------

const GOOD_ANSWER = { candidates: [{ content: { parts: [{ text: JSON.stringify(ANSWER) }] } }] };
const geminiEnv = Object.assign({ GEMINI_API_KEY: "k", GEMINI_MODEL: "main-model", GEMINI_FALLBACK_MODEL: "lite-model" }, env);

// 順番に返す答え（[状態, 本文]）を決めて、呼ばれたモデルを記録する
async function withGemini(answers, run) {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(decodeURIComponent(String(url).split("/models/")[1].split(":")[0]));
        const [status, body] = answers.shift();
        return new Response(JSON.stringify(body), { status });
    };
    try {
        await run(calls);
    } finally {
        globalThis.fetch = realFetch;
    }
}

const busy = (status) => [status, { error: { code: status, message: "The model is overloaded." } }];

test("503（混んでいる）は、同じモデルでもう1回頼む", async () => {
    await withGemini([busy(503), [200, GOOD_ANSWER]], async (calls) => {
        const { handle } = setup({ askGemini: defaultDeps.askGemini });
        const response = await handle(request({ title: "作品" }), geminiEnv);
        assert.equal(response.status, 200);
        assert.deepEqual(calls, ["main-model", "main-model"]);
    });
});

test("やり直しても混んでいたら、予備のモデルに頼む", async () => {
    await withGemini([busy(503), busy(503), [200, GOOD_ANSWER]], async (calls) => {
        const { handle } = setup({ askGemini: defaultDeps.askGemini });
        const response = await handle(request({ title: "作品" }), geminiEnv);
        assert.equal(response.status, 200);
        assert.deepEqual(calls, ["main-model", "main-model", "lite-model"]);
    });
});

test("429（そのモデルの上限）は、やり直さずに予備のモデルへ", async () => {
    await withGemini([busy(429), [200, GOOD_ANSWER]], async (calls) => {
        const { handle } = setup({ askGemini: defaultDeps.askGemini });
        assert.equal((await handle(request({ title: "作品" }), geminiEnv)).status, 200);
        assert.deepEqual(calls, ["main-model", "lite-model"]);
    });
});

test("どのモデルも混んでいたら 503。理由を返し、今日の回数には数えない", async () => {
    await withGemini([busy(503), busy(503), busy(503), busy(503)], async (calls) => {
        const { handle, counts } = setup({ askGemini: defaultDeps.askGemini });
        const response = await handle(request({ title: "作品" }), geminiEnv);
        assert.equal(response.status, 503);
        const body = await response.json();
        assert.equal(body.error, "busy");
        assert.equal(body.detail, "Gemini 503（lite-model）: The model is overloaded.");
        assert.equal(counts.get("uid1"), 0);
        assert.equal(calls.length, 4);
    });
});
