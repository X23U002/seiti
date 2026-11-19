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

test("検索：登録済みの聖地を候補に出し、選ぶと詳細が開く。そのあと「近くの聖地」で移れる", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);

    const input = page.locator(".mapboxgl-ctrl-geocoder--input");
    await input.click();
    await input.pressSequentially("宇治橋", { delay: 20 });
    // 日本語の入力ではキーの合図が出ないので、最後にキーを1つ押して検索を始めさせる
    await input.press("End");
    const options = page.locator(".mapboxgl-ctrl-geocoder .suggestions li");
    await expect(options.first()).toContainText("宇治橋");

    await options.first().click();
    await expect(page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`)).toHaveClass(/is-selected/);
    await expect(page.locator(".popup-meta")).toBeVisible();

    // 検索で1か所だけ表示している時も、「近くの聖地」でほかの聖地へ移れる
    const nearby = page.locator(".popup-nearby-item").first();
    const targetId = await nearby.getAttribute("data-spot-id");
    await nearby.click();
    await expect(page.locator(`.mapboxgl-marker[data-spot-id="${targetId}"]`)).toHaveClass(/is-selected/);
    await expect(page.locator(".popup-spot")).toContainText(SPOTS.find((spot) => spot.id === targetId).spot_name);
});

test("ルート案内の区間ごとに、徒歩の目安と「電車で」（Googleマップの乗換案内）が出る", async ({ page }) => {
    const [station, bridge, nagoya] = ["京阪宇治駅", "宇治橋", "名古屋国際会議場（センチュリーホール）"].map(spotNamed);
    await seed(page, {
        data: withSpots({
            course: { c1: { title_name: station.title_name, course_name: "遠い区間ありのルート", description: "", spot_ids: [station.id, bridge.id, nagoya.id], updated_at: { __ts: 1 } } }
        })
    });
    await page.goto("html/map.html?course=c1");
    await expect(page.locator(".routeItem")).toHaveCount(3);

    const legs = page.locator("#routeList .route-leg");
    await expect(legs).toHaveCount(3);
    const transitUrl = async (i) => new URL(await legs.nth(i).locator("a.route-leg-transit").getAttribute("href"));
    const at = (spot) => `${spot.coord.latitude},${spot.coord.longitude}`;

    // 1か所目は現在地から（origin なし）
    await expect(legs.nth(0)).toContainText("現在地から");
    let url = await transitUrl(0);
    expect(url.searchParams.get("origin")).toBeNull();
    expect(url.searchParams.get("destination")).toBe(at(station));
    expect(url.searchParams.get("travelmode")).toBe("transit");

    // 近い区間：徒歩の目安。電車はすすめない
    await expect(legs.nth(1)).toContainText(/徒歩 約\d+m・\d+分/);
    await expect(legs.nth(1).locator("a.route-leg-transit")).not.toHaveClass(/is-recommended/);
    url = await transitUrl(1);
    expect(url.searchParams.get("origin")).toBe(at(station));
    expect(url.searchParams.get("destination")).toBe(at(bridge));

    // 遠い区間（宇治 → 名古屋）：電車をすすめる
    await expect(legs.nth(2)).toContainText("電車がおすすめ");
    await expect(legs.nth(2).locator("a.route-leg-transit")).toHaveClass(/is-recommended/);
    url = await transitUrl(2);
    expect(url.searchParams.get("origin")).toBe(at(bridge));
    expect(url.searchParams.get("destination")).toBe(at(nagoya));
});
