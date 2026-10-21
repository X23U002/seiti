// ==========================================
// AI のおすすめ巡礼プラン（Cloudflare Workers）
// アプリ → このサーバー → Gemini API の中継。Gemini の API キーはここにだけ置く
//
// POST /plan  { "title": "作品名" }
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

export class PlanError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
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

async function askGemini(title, spots, env) {
    const model = env.GEMINI_MODEL || "gemini-flash-latest";
    const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
        {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: [{ role: "user", parts: [{ text: buildUserPrompt(title, spots) }] }],
                generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA }
            })
        }
    );
    if (response.status === 429 || response.status === 503) throw new PlanError("busy");
    if (!response.ok) {
        console.error("Gemini", response.status, await response.text());
        throw new PlanError("failed");
    }
    return parseGeminiResponse(await response.json());
}

// 1人1日の回数（KV の「uid:日付」に数を入れる）
const usage = {
    async count(uid, env, now) {
        return Number(await env.USAGE.get(uid + ":" + japanDate(now))) || 0;
    },
    async add(uid, env, now, current) {
        await env.USAGE.put(uid + ":" + japanDate(now), String(current + 1), { expirationTtl: 2 * 24 * 60 * 60 });
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

function errorResponse(code, headers) {
    const [status, message] = ERRORS[code] || ERRORS.failed;
    return json({ error: code, message }, status, headers);
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

            const limit = Number(env.DAILY_LIMIT) || 5;
            const now = deps.now();
            const used = await deps.usage.count(uid, env, now);
            if (used >= limit) throw new PlanError("limit");

            const spots = await deps.fetchSpots(title, env);
            if (spots.length < 2) throw new PlanError("no-spots");

            // AI に頼む前に数える（失敗が続いても、無料枠を使い切られないように）
            await deps.usage.add(uid, env, now, used);

            const plan = finalizePlan(await deps.askGemini(title, spots, env), spots);
            if (!plan) throw new PlanError("failed");

            return json({ plan, remaining: Math.max(0, limit - used - 1) }, 200, cors);
        } catch (error) {
            if (!(error instanceof PlanError)) console.error(error);
            return errorResponse(error instanceof PlanError ? error.code : "failed", cors);
        }
    };
}

export default { fetch: createHandler() };
