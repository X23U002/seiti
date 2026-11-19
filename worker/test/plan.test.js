// AI への頼み方と、答えの確かめ方のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { DURATIONS, buildUserPrompt, finalizePlan, japanDate, parseGeminiResponse, readOptions } from "../src/plan.js";

// 宇治のあたりに南北に並んだ聖地
const SPOTS = [
    { id: "a", spot_name: "北の駅", spot_info: "1期1話の場面", season: 1, episode: 1, coord: { latitude: 34.900, longitude: 135.800 } },
    { id: "b", spot_name: "真ん中の橋", spot_info: "", coord: { latitude: 34.895, longitude: 135.800 } },
    { id: "c", spot_name: "南の山", spot_info: "x".repeat(200), coord: { latitude: 34.890, longitude: 135.800 } }
];

test("AI に渡す文：作品名と、ID・名前・期話・場面（短く）・位置", () => {
    const prompt = buildUserPrompt("テスト作品", SPOTS);
    assert.match(prompt, /^作品：テスト作品\n/);
    const list = JSON.parse(prompt.split("聖地の一覧（JSON）：\n")[1]);
    assert.deepEqual(list[0], { id: "a", name: "北の駅", 期: 1, 話: 1, 場面: "1期1話の場面", lat: 34.9, lng: 135.8 });
    assert.equal(Array.from(list[2].場面).length, 80);
});

test("Gemini の答えから JSON を取り出す", () => {
    const body = { candidates: [{ content: { parts: [{ text: '{"plan_title":"t",' }, { text: '"summary":"s","stops":[]}' }] } }] };
    assert.deepEqual(parseGeminiResponse(body), { plan_title: "t", summary: "s", stops: [] });
    assert.equal(parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "壊れた" }] } }] }), null);
    assert.equal(parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }), null);
});

test("答えの確かめ：ない聖地・2回目は捨て、近い順に並べ直し、時間を収める", () => {
    const plan = finalizePlan({
        plan_title: "宇治をめぐる",
        summary: "半日コース",
        stops: [
            { spot_id: "c", stay_minutes: 999, comment: "山" },
            { spot_id: "zzz", stay_minutes: 10, comment: "一覧にない" },
            { spot_id: "a", stay_minutes: 1, comment: "駅" },
            { spot_id: "c", stay_minutes: 10, comment: "2回目" },
            { spot_id: "b", stay_minutes: "abc", comment: "橋" }
        ]
    }, SPOTS);

    // AI が選んだ1つ目（c）から、近い順に回る
    assert.deepEqual(plan.stops.map((stop) => stop.id), ["c", "b", "a"]);
    assert.deepEqual(plan.stops.map((stop) => stop.stay_minutes), [120, 20, 5]);
    assert.equal(plan.title, "宇治をめぐる");
    assert.ok(plan.walk_meters > 1000 && plan.walk_meters < 1200);
    assert.equal(plan.total_minutes, 145 + Math.round(plan.walk_meters * 1.3 / 80));
});

test("答えの確かめ：使える聖地が2か所未満・形が違う時は使わない", () => {
    assert.equal(finalizePlan({ stops: [{ spot_id: "a", stay_minutes: 10, comment: "" }] }, SPOTS), null);
    assert.equal(finalizePlan({ stops: "なし" }, SPOTS), null);
    assert.equal(finalizePlan(null, SPOTS), null);
});

test("答えの確かめ：多すぎる時は決まった数まで", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
        id: "s" + i, spot_name: "聖地" + i, coord: { latitude: 34.9 + i / 1000, longitude: 135.8 }
    }));
    const plan = finalizePlan({ stops: many.map((spot) => ({ spot_id: spot.id, stay_minutes: 10, comment: "" })) }, many);
    assert.equal(plan.stops.length, DURATIONS.half.stops[1]);
    assert.equal(finalizePlan({ stops: many.map((spot) => ({ spot_id: spot.id, stay_minutes: 10, comment: "" })) }, many, readOptions({ duration: "day" })).stops.length, 10);
    assert.equal(finalizePlan({ stops: many.map((spot) => ({ spot_id: spot.id, stay_minutes: 10, comment: "" })) }, many, readOptions({ duration: "short" })).stops.length, 4);
});

test("日本時間の日付で数える", () => {
    assert.equal(japanDate(Date.parse("2026-10-20T14:59:59Z")), "2026-10-20");
    assert.equal(japanDate(Date.parse("2026-10-20T15:00:00Z")), "2026-10-21");
});

test("条件：使える時間・出発地・希望をそろえ、AI に渡す文に入れる", () => {
    assert.deepEqual(readOptions({}), { duration: "half", start: "", wishes: "" });
    assert.deepEqual(readOptions({ duration: "evil", start: 123, wishes: null }), { duration: "half", start: "", wishes: "" });
    const options = readOptions({ duration: "day", start: "  京都駅  ", wishes: "x".repeat(300) });
    assert.equal(options.duration, "day");
    assert.equal(options.start, "京都駅");
    assert.equal(options.wishes.length, 200);

    const prompt = buildUserPrompt("テスト作品", SPOTS, readOptions({ duration: "short", start: "宇治駅", wishes: "ベンチは必ず" }));
    assert.match(prompt, /使える時間：2時間くらい/);
    assert.match(prompt, /選ぶ聖地の数：2〜4か所/);
    assert.match(prompt, /出発地：宇治駅/);
    assert.match(prompt, /希望：ベンチは必ず/);
    // 何も無ければ半日で、出発地・希望の行は無い
    const plain = buildUserPrompt("テスト作品", SPOTS);
    assert.match(plain, /使える時間：半日/);
    assert.doesNotMatch(plain, /出発地|希望/);
});
