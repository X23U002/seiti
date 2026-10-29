// ==========================================
// AI のおすすめ巡礼プラン（Cloudflare Workers）
// アプリ → このサーバー → Gemini API の中継。Gemini の API キーはここにだけ置く
//
// POST /plan  { "title": "作品名", "duration": "short" | "half" | "day", "start": "出発地", "wishes": "希望" }
//   （duration・start・wishes は無くてもよい。無ければ半日・なし）
//   Authorization: Bearer <Firebase のログインの証明（ID トークン）>
// → 200 { plan: { title, summary, walk_meters, total_minutes, stops: [...] }, remaining: 今日あと何回 }
//
// 守り：
// ・決めたサイト（ALLOWED_ORIGINS）からの呼び出しだけ受ける
// ・ログインしている人だけ（ID トークンを Google の公開鍵で確かめる）
// ・1人1日 DAILY_LIMIT 回まで（KV で数える）
// ・聖地のデータはこのサーバーが Firestore から読む（アプリから送られたものは使わない）
// ==========================================
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
    RESPONSE_SCHEMA,
    SYSTEM_PROMPT,
    buildUserPrompt,
    readOptions,
    finalizePlan,
    japanDate,
    parseGeminiResponse
} from "./plan.js";

const FIREBASE_KEYS = createRemoteJWKSet(
    new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

// 失敗の種類 → アプリに返す状態と、利用者向けの文
const ERRORS = {
    "bad-request": [400, "作品を指定してください。"],
    "not-logged-in": [401, "ログインすると使えます。"],
    "forbidden-origin": [403, "このサイトからは使えません。"],
    "no-spots": [404, "この作品の聖地が見つかりませんでした。"],
    "limit": [429, "今日はこれ以上作れません。明日またお試しください。"],
    "busy": [503, "AI が混み合っています。少し待ってからもう一度お試しください。"],
    "failed": [502, "プランを作れませんでした。もう一度お試しください。"]
};

// detail：失敗の理由（調べる人向け。アプリは F12 のコンソールに出す。キーなどの秘密は入れない）
// refund：利用者のせいではない失敗（Gemini が断った・届かなかった）なので、今日の回数に数えない
export class PlanError extends Error {
    constructor(code, detail, refund = false) {
        super(code);
        this.code = code;
        this.detail = detail || "";
        this.refund = refund;
    }
}

// ---------- 本番で使う部品（テストでは差しかえる） ----------

async function verifyFirebaseToken(token, env) {
    const { payload } = await jwtVerify(token, FIREBASE_KEYS, {
        issuer: "https://securetoken.google.com/" + env.FIREBASE_PROJECT_ID,
        audience: env.FIREBASE_PROJECT_ID
    });
    if (!payload.sub) throw new Error("uid がありません");
    return payload.sub;
}

function fromRest(value) {
    if (!value) return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return value.doubleValue;
    if ("geoPointValue" in value) return value.geoPointValue;
    return null;
}

// その作品の聖地（誰でも読めるデータなので、ログインの証明は付けない）
async function fetchSpots(title, env) {
    const url = "https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID +
        "/databases/(default)/documents:runQuery";
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: "spot" }],
                where: { fieldFilter: { field: { fieldPath: "title_name" }, op: "EQUAL", value: { stringValue: title } } },
                limit: 200
            }
        })
    });
    if (!response.ok) throw new Error("Firestore " + response.status);

    const rows = await response.json();
    return rows
        .filter((row) => row.document)
        .map((row) => {
            const fields = row.document.fields || {};
            const spot = { id: row.document.name.split("/").pop() };
            Object.keys(fields).forEach((key) => { spot[key] = fromRest(fields[key]); });
            return spot;
        })
        .filter((spot) => spot.coord && spot.spot_name);
}

// 混んでいる（503）時に、やり直すまで待つ時間（テストでは 0 にする）
export const RETRY_WAIT = { ms: 1500 };

// Gemini を待つ時間（アプリは 60 秒で諦めるので、その前に答えを返す）
// ・全体で total まで
// ・予備のモデルがある時、最初のモデルは first まで（遅い時は、速い予備のモデルに切りかえる）
export const GEMINI_TIME_LIMIT = { total: 45000, first: 28000, min: 3000 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google のエラー文（取り出せなければ本文のまま）
async function errorReason(response) {
    const text = await response.text();
    try {
        return String(JSON.parse(text).error.message || text).slice(0, 300);
    } catch (error) {
        return text.slice(0, 300);
    }
}

function callGemini(model, title, spots, env, options, signal) {
    return fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
        {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: [{ role: "user", parts: [{ text: buildUserPrompt(title, spots, options) }] }],
                generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA }
            }),
            signal
        }
    );
}

// 混んでいる時の手当て：
// ・503（混んでいる）は少し待って、同じモデルでもう1回
// ・429（そのモデルの無料枠の上限）や、やり直しても混んでいる時は、予備のモデル（GEMINI_FALLBACK_MODEL）へ
// ・答えが遅い時（GEMINI_TIME_LIMIT）も、予備のモデルへ
async function askGemini(title, spots, env, options) {
    const models = [...new Set([env.GEMINI_MODEL || "gemini-flash-latest", env.GEMINI_FALLBACK_MODEL].filter(Boolean))];
    const deadline = Date.now() + GEMINI_TIME_LIMIT.total;
    let busyReason = "";

    for (const [index, model] of models.entries()) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const left = deadline - Date.now();
            if (left < GEMINI_TIME_LIMIT.min) throw new PlanError("busy", busyReason || "Gemini 時間切れ", true);
            const limit = index < models.length - 1 ? Math.min(left, GEMINI_TIME_LIMIT.first) : left;

            let response;
            try {
                response = await callGemini(model, title, spots, env, options, AbortSignal.timeout(limit));
            } catch (error) {
                if (error.name !== "TimeoutError") throw error;
                busyReason = "Gemini 時間切れ（" + model + "・" + Math.round(limit / 1000) + "秒）";
                console.warn(busyReason);
                break;
            }

            if (response.status === 429 || response.status === 503) {
                busyReason = "Gemini " + response.status + "（" + model + "）: " + await errorReason(response);
                console.warn(busyReason);
                if (response.status === 503 && attempt === 0) {
                    await wait(RETRY_WAIT.ms);
                    continue;
                }
                break;
            }

            if (!response.ok) {
                const reason = await errorReason(response);
                console.error("Gemini", response.status, model, reason);
                throw new PlanError("failed", "Gemini " + response.status + "（" + model + "）: " + reason, true);
            }

            return readAnswer(await response.json());
        }
    }

    // Google が断った分は無料枠も減らないので、今日の回数には数えない
    throw new PlanError("busy", busyReason, true);
}

function readAnswer(body) {
    const answer = parseGeminiResponse(body);
    if (!answer) {
        console.error("Gemini の答えを読めませんでした", JSON.stringify(body).slice(0, 2000));
        const reason = (body.promptFeedback && body.promptFeedback.blockReason) ||
            (body.candidates && body.candidates[0] && body.candidates[0].finishReason) || "形が違う";
        throw new PlanError("failed", "Gemini の答えを JSON として読めませんでした（" + reason + "）");
    }
    return answer;
}

// 1人1日の回数（KV の「uid:日付」に数を入れる）
const usage = {
    async count(uid, env, now) {
        return Number(await env.USAGE.get(uid + ":" + japanDate(now))) || 0;
    },
    async add(uid, env, now, current) {
        await usage.set(uid, env, now, current + 1);
    },
    async set(uid, env, now, value) {
        await env.USAGE.put(uid + ":" + japanDate(now), String(value), { expirationTtl: 2 * 24 * 60 * 60 });
    }
};

export const defaultDeps = { verifyFirebaseToken, fetchSpots, askGemini, usage, now: () => Date.now() };

// ---------- 受け付け ----------

function allowedOrigins(env) {
    return String(env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

function json(body, status, headers) {
    return new Response(JSON.stringify(body), {
        status,
        headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers)
    });
}

function errorResponse(code, headers, detail) {
    const [status, message] = ERRORS[code] || ERRORS.failed;
    return json(Object.assign({ error: code, message }, detail ? { detail } : {}), status, headers);
}

export function createHandler(deps = defaultDeps) {
    return async function handle(request, env) {
        const origin = request.headers.get("Origin") || "";
        if (!allowedOrigins(env).includes(origin)) return errorResponse("forbidden-origin", {});
        const cors = corsHeaders(origin);

        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
        const path = new URL(request.url).pathname;
        if (request.method !== "POST" || path !== "/plan") return json({ error: "not-found" }, 404, cors);

        try {
            const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
            if (!token) throw new PlanError("not-logged-in");
            let uid;
            try {
                uid = await deps.verifyFirebaseToken(token, env);
            } catch (error) {
                throw new PlanError("not-logged-in");
            }

            const body = await request.json().catch(() => ({}));
            const title = typeof body.title === "string" ? body.title.trim() : "";
            if (!title || title.length > 100) throw new PlanError("bad-request");
            // 使える時間・出発地・希望（無ければ半日・なし）
            const options = readOptions(body);

            const limit = Number(env.DAILY_LIMIT) || 5;
            const now = deps.now();
            const used = await deps.usage.count(uid, env, now);
            if (used >= limit) throw new PlanError("limit");

            const spots = await deps.fetchSpots(title, env);
            if (spots.length < 2) throw new PlanError("no-spots");

            // AI に頼む前に数える（失敗が続いても、無料枠を使い切られないように）
            await deps.usage.add(uid, env, now, used);

            let answer;
            try {
                answer = await deps.askGemini(title, spots, env, options);
            } catch (error) {
                // Gemini が断った・混んでいた・届かなかった時は、数えた分を戻す
                // （答えはあったが使えなかった時は、無料枠を使っているので数えたまま）
                if (!(error instanceof PlanError) || error.refund) {
                    await deps.usage.set(uid, env, now, used);
                }
                throw error;
            }
            const plan = finalizePlan(answer, spots, options);
            if (!plan) {
                console.error("使えるプランになりませんでした", JSON.stringify(answer).slice(0, 2000));
                throw new PlanError("failed", "Gemini の答えに、一覧にある聖地が2か所以上入っていませんでした");
            }

            return json({ plan, remaining: Math.max(0, limit - used - 1) }, 200, cors);
        } catch (error) {
            if (!(error instanceof PlanError)) console.error(error);
            return error instanceof PlanError
                ? errorResponse(error.code, cors, error.detail)
                : errorResponse("failed", cors, "サーバーの中で失敗しました");
        }
    };
}

export default { fetch: createHandler() };
