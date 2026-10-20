// 地図画面：ピン・詳細・強調表示・おすすめルート・読み込みの予備
import { test, expect, seed, withSpots, spotNamed, SPOTS, SEARCH_PLACE } from "../helpers.js";

const pins = (page) => page.locator(".mapboxgl-marker[data-spot-id]");

test("聖地のピンと検索バーが出て、聖地の一覧を端末に残す", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);
    await expect(page.locator("#search-box")).toBeVisible();
    const cached = await page.evaluate(() => JSON.parse(localStorage.getItem("seitiSpotCache") || "[]").length);
    expect(cached).toBe(SPOTS.length);
});

test("Firestore の通信が止められても、Web API から聖地を読む", async ({ page, restCalls }) => {
    await seed(page, { local: { mockFsHang: "1" } });
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length, { timeout: 20_000 });
    expect(restCalls).toContain("GET /spot");
});

test("?spot= で聖地の詳細が開き、そのピンだけ強調される", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await seed(page);
    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(page.locator(".popup-meta")).toBeVisible();

    const selected = page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`);
    await expect(selected).toHaveClass(/is-selected/);
    await expect(page.locator("#map")).toHaveClass(/has-selected/);
    await expect(page.locator("a.popup-title")).toHaveAttribute("href", /work\.html\?title=/);

    await page.locator(".mapboxgl-popup-close-button").click();
    await expect(selected).not.toHaveClass(/is-selected/);
    await expect(page.locator("#map")).not.toHaveClass(/has-selected/);
});

test("?course= でおすすめルートが順番どおりにルート案内へ入る", async ({ page }) => {
    const order = ["京阪宇治駅", "宇治橋", "大吉山展望台"].map((name) => spotNamed(name));
    await seed(page, {
        data: withSpots({
            course: { c1: { title_name: order[0].title_name, course_name: "テストルート", description: "", spot_ids: order.map((s) => s.id), updated_at: { __ts: 1 } } }
        })
    });
    await page.goto("html/map.html?course=c1");
    const items = page.locator(".routeItem");
    await expect(items).toHaveCount(3);
    for (let i = 0; i < order.length; i++) {
        await expect(items.nth(i)).toContainText(order[i].spot_name);
    }
});

test("検索：登録済みの聖地を先に出し、選ぶとその聖地の詳細が開く", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);

    await page.fill("#search-box", "宇治橋");
    const options = page.locator("#search-suggestions .search-suggestion");
    await expect(options.first()).toContainText("登録済みの聖地");
    await expect(options.first()).toContainText("宇治橋");
    await expect(options.last()).toContainText(SEARCH_PLACE.name);

    await options.first().click();
    await expect(page.locator("#search-suggestions")).toBeHidden();
    await expect(page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`)).toHaveClass(/is-selected/);
    await expect(page.locator(".popup-meta")).toBeVisible();

    // 検索で1か所だけ表示している時も、「近くの聖地」でほかの聖地へ移れる
    const nearby = page.locator(".popup-nearby-item").first();
    const targetId = await nearby.getAttribute("data-spot-id");
    await nearby.click();
    await expect(page.locator(`.mapboxgl-marker[data-spot-id="${targetId}"]`)).toHaveClass(/is-selected/);
    await expect(page.locator(".popup-spot")).toContainText(SPOTS.find((spot) => spot.id === targetId).spot_name);
});

test("検索：聖地以外の場所を選ぶと仮のピンを置き、地図を押すと消える", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);

    await page.fill("#search-box", "京都駅");
    await page.locator("#search-suggestions .search-suggestion", { hasText: SEARCH_PLACE.name }).click();

    // 聖地のピン（data-spot-id あり）とは別の、仮のピンが1つ置かれて、そこへ移動する
    const temporary = page.locator(".mapboxgl-marker:not([data-spot-id])");
    await expect(temporary).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.__map.getCenter().toArray().map((v) => v.toFixed(3))), { timeout: 10_000 })
        .toEqual([SEARCH_PLACE.lng.toFixed(3), SEARCH_PLACE.lat.toFixed(3)]);

    await page.mouse.click(195, 500);
    await expect(temporary).toHaveCount(0);
    await expect(page.locator("#search-box")).toHaveValue("");
});
