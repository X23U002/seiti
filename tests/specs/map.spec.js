// 地図画面：ピン・詳細・強調表示・おすすめルート・読み込みの予備
import { test, expect, seed, withSpots, spotNamed, SPOTS } from "../helpers.js";

const pins = (page) => page.locator(".mapboxgl-marker[data-spot-id]");

test("聖地のピンと検索バーが出て、聖地の一覧を端末に残す", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);
    await expect(page.locator(".mapboxgl-ctrl-geocoder")).toHaveCount(1);
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
