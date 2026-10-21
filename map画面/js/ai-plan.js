// ==========================================
// AI のおすすめ巡礼プラン（作品ページで使う）
// 中継サーバー（worker/ の Cloudflare Workers）に作品名を送ると、
// AI（Gemini）が選んだ聖地・滞在時間・見どころが返ってくる
// ログインが必要（1人1日の回数はサーバーで数える）
// ==========================================
import { getCurrentUser } from "./firebase-db.js?v=917161b9";

// 中継サーバーの URL（worker/README.md の手順で公開したもの。空にすると AI の欄を出さない）
const AI_PLAN_ENDPOINT = "https://seiti-ai-plan.x23u002.workers.dev/plan";

// 待つ時間の上限（AI の答えは数秒〜数十秒かかる）
const TIMEOUT_MS = 60000;

function endpoint() {
    // 自動テストでは、差しかえたサーバーの URL を使う
    return window.SEITI_AI_PLAN_ENDPOINT || AI_PLAN_ENDPOINT;
}

export function isAiPlanAvailable() {
    return !!endpoint();
}

function planError(code, message) {
    return Object.assign(new Error(message), { code });
}

// { plan: { title, summary, walk_meters, total_minutes, stops: [{ id, name, season, episode, stay_minutes, comment }] }, remaining }
export async function requestAiPlan(title) {
    const user = await getCurrentUser();
    if (!user) throw planError("not-logged-in", "ログインすると使えます。");

    // ログインの証明（1時間で切れるので、切れていれば Google から取り直す）
    let token;
    try {
        token = await user.getIdToken();
    } catch (error) {
        console.warn("AI プラン：ログインの証明を取れませんでした:", error);
        throw planError("auth",
            "ログインの確認ができませんでした。広告ブロックなどの拡張機能を切って、ページを読み込み直してください。");
    }

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    let response;
    try {
        response = await fetch(endpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({ title: title }),
            signal: controller.signal
        });
    } catch (error) {
        console.warn("AI プラン：中継サーバーと通信できませんでした:", error);
        throw planError("network", "通信できませんでした。通信状況を確認して、もう一度お試しください。");
    } finally {
        clearTimeout(timer);
    }

    const body = await response.json().catch(function () { return {}; });
    if (!response.ok || !body.plan) {
        // 失敗の理由（調べる人向け）は F12 のコンソールに出す
        if (body.detail) console.warn("AI プランを作れなかった理由:", body.detail);
        throw planError(body.error || "failed", body.message || "プランを作れませんでした。もう一度お試しください。");
    }
    return body;
}

// ---------- 前に作ったプラン（この端末に残し、開き直しても回数を使わずに見られる） ----------

const STORAGE_KEY = "seitiAiPlans";

export function readSavedPlan(title) {
    try {
        return (JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"))[title] || null;
    } catch (error) {
        return null;
    }
}

export function savePlan(title, plan) {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        saved[title] = plan;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
        // 保存できない環境では何もしない
    }
}
