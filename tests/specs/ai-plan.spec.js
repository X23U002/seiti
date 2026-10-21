// 作品ページの「AI におまかせプラン」（中継サーバーの答えは差しかえる）
import { test, expect, seed, withSpots, PROFILE, spotNamed } from "../helpers.js";

const EUPHO = "響け！ユーフォニアム";
const ENDPOINT = "https://ai-plan.test/plan";
const [station, bridge, bench] = ["京阪宇治駅", "宇治橋", "久美子ベンチ"].map(spotNamed);

const PLAN = {
    title: "宇治の名場面めぐり",
    summary: "駅から宇治川沿いを歩く半日コース",
    walk_meters: 1500,
    total_minutes: 95,
    stops: [
        { id: station.id, name: station.spot_name, season: 1, episode: 1, stay_minutes: 15, comment: "麗奈と再会した駅" },
        { id: bridge.id, name: bridge.spot_name, season: 0, episode: 0, stay_minutes: 20, comment: "久美子が走った橋" },
        { id: bench.id, name: bench.spot_name, season: 0, episode: 0, stay_minutes: 30, comment: "いつものベンチ" }
    ]
};

// 中継サーバーの代わり。受け取った内容を requests に残す
async function fakeServer(page, answer) {
    const requests = [];
    await page.addInitScript((url) => { window.SEITI_AI_PLAN_ENDPOINT = url; }, ENDPOINT);
    await page.route(ENDPOINT, async (route) => {
        requests.push({ body: route.request().postDataJSON(), auth: route.request().headers().authorization });
        const [status, body] = answer();
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    return requests;
}

const loggedIn = { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) };
const openWork = (page) => page.goto("html/work.html?title=" + encodeURIComponent(EUPHO));

test("ふだんは公開した中継サーバーに作品名を送る", async ({ page }) => {
    const sent = [];
    await page.route("https://seiti-ai-plan.x23u002.workers.dev/plan", async (route) => {
        sent.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan: PLAN, remaining: 4 }) });
    });
    await seed(page, loggedIn);
    await openWork(page);
    await page.click("#ai-plan-btn");
    await expect(page.locator("#ai-plan-result h3")).toHaveText(PLAN.title);
    expect(sent).toEqual([{ title: EUPHO }]);
});

test("未ログインだと、ログインへの案内を出す", async ({ page }) => {
    await fakeServer(page, () => [200, { plan: PLAN, remaining: 4 }]);
    await seed(page);
    await openWork(page);
    await expect(page.locator("#ai-section")).toBeVisible();
    await expect(page.locator("#ai-plan-login")).toBeVisible();
    await expect(page.locator("#ai-plan-btn")).toBeHidden();
});

test("ログイン中は、ログインへの案内を出さない", async ({ page }) => {
    await fakeServer(page, () => [200, { plan: PLAN, remaining: 4 }]);
    await seed(page, loggedIn);
    await openWork(page);
    await expect(page.locator("#ai-plan-btn")).toBeVisible();
    await expect(page.locator("#ai-plan-login")).toBeHidden();
});

test("作品名とログインの証明を送り、プランを出して地図で開ける。開き直しても残る", async ({ page }) => {
    const requests = await fakeServer(page, () => [200, { plan: PLAN, remaining: 4 }]);
    await seed(page, loggedIn);
    await openWork(page);
    await page.click("#ai-plan-btn");

    const result = page.locator("#ai-plan-result");
    await expect(result).toBeVisible();
    await expect(result.locator("h3")).toHaveText(PLAN.title);
    await expect(result).toContainText("3か所・約1.5km");
    await expect(result).toContainText("合計 約1時間35分");
    await expect(result.locator(".ai-plan-stops > li")).toHaveCount(3);
    await expect(result.locator(".ai-plan-stops > li").first()).toContainText("1期 EP1");
    await expect(result.locator(".ai-plan-stops > li").first()).toContainText("麗奈と再会した駅");
    await expect(page.locator("#ai-plan-status")).toContainText("あと 4 回");
    expect(requests).toEqual([{ body: { title: EUPHO }, auth: "Bearer test-token" }]);

    // 地図で開く：保存したルートと同じ map.html?route=
    const href = await result.locator("a.btn-primary").getAttribute("href");
    expect(href).toBe("map.html?route=" + encodeURIComponent([station.id, bridge.id, bench.id].join(",")));
    await result.locator("a.btn-primary").click();
    await expect(page.locator(".routeItem")).toHaveCount(3);
    await expect(page.locator(".routeItem").first()).toContainText(station.spot_name);

    // 作品ページを開き直すと、回数を使わずに前のプランが出る
    await openWork(page);
    await expect(page.locator("#ai-plan-result h3")).toHaveText(PLAN.title);
    await expect(page.locator("#ai-plan-btn")).toHaveText("別のプランを作ってもらう");
    expect(requests).toHaveLength(1);
});

test("回数の上限など、サーバーの断りの文をそのまま出す", async ({ page }) => {
    await fakeServer(page, () => [429, { error: "limit", message: "今日はこれ以上作れません。明日またお試しください。" }]);
    await seed(page, loggedIn);
    await openWork(page);
    await page.click("#ai-plan-btn");
    await expect(page.locator("#ai-plan-status")).toHaveText("今日はこれ以上作れません。明日またお試しください。");
    await expect(page.locator("#ai-plan-result")).toBeHidden();
    await expect(page.locator("#ai-plan-btn")).toBeEnabled();
});
