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

test("ピンに触る前にメニューの「おすすめルート」を開いても、読み込めたらルートが出る", async ({ page }) => {
    const order = ["京阪宇治駅", "宇治橋"].map(spotNamed);
    // Firestore が遅い（8秒待ってから Web API で読む）時の再現
    await seed(page, {
        local: { mockFsHang: "1" },
        data: withSpots({
            course: { c1: { title_name: order[0].title_name, course_name: "すぐ開くルート", description: "", spot_ids: order.map((s) => s.id), updated_at: { __ts: 1 } } }
        })
    });
    await page.goto("html/map.html");
    await page.evaluate(() => window.openCourses());
    const list = page.locator("#course-list");
    await expect(list).toContainText("読み込んでいます");
    await expect(list.locator(".course-card")).toContainText("すぐ開くルート", { timeout: 30_000 });
    await list.locator(".course-start").click();
    await expect(page.locator(".routeItem")).toHaveCount(2);
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

test("地図上にルートを生成すると、区間の時間も実際の道のり（画面下の合計と同じ）になる。解除すると目安に戻る", async ({ page }) => {
    const order = ["京阪宇治駅", "宇治橋", "大吉山展望台"].map((name) => spotNamed(name));
    await seed(page, {
        data: withSpots({
            course: { c1: { title_name: order[0].title_name, course_name: "テストルート", description: "", spot_ids: order.map((s) => s.id), updated_at: { __ts: 1 } } }
        })
    });
    // Mapbox の徒歩ルートの答え（区間ごとの道のりと時間）
    await page.route(/\/directions\/v5\/mapbox\/walking\//, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
            code: "Ok",
            routes: [{
                distance: 1700,
                duration: 1230,
                legs: [0, 1].map((i) => ({
                    distance: [450, 1250][i],
                    duration: [330, 900][i],
                    steps: [{ geometry: { type: "LineString", coordinates: [order[i], order[i + 1]].map((s) => [s.coord.longitude, s.coord.latitude]) } }]
                })),
                geometry: { type: "LineString", coordinates: order.map((s) => [s.coord.longitude, s.coord.latitude]) }
            }]
        })
    }));
    await page.goto("html/map.html?course=c1");
    const legs = page.locator("#routeList .route-leg");
    await expect(legs).toHaveCount(3);
    await expect(legs.nth(1)).toContainText("（目安）");

    await page.click("#generate-mapbox-route");
    await expect(page.locator("#toast")).toContainText("約1.7km・徒歩約21分");
    await expect(legs.nth(1)).toHaveText(/^徒歩 約450m・6分/);
    await expect(legs.nth(2)).toHaveText(/^徒歩 約1\.3km・15分/);
    await expect(legs.nth(1)).not.toContainText("目安");

    // 区間ごとに色を変えた線（地図の線とルート案内の印が同じ色）と、ピンの回る順番の番号
    const features = await page.evaluate(() => window.__map.getSource("selected-spots-route")._data.features);
    expect(features.map((feature) => feature.properties.color)).toEqual(["#1e88e5", "#43a047"]);
    await expect(legs.nth(1)).toHaveClass(/has-route-color/);
    expect(await legs.nth(1).evaluate((el) => el.style.getPropertyValue("--leg-color"))).toBe("#1e88e5");
    for (let i = 0; i < order.length; i++) {
        await expect(page.locator(`.mapboxgl-marker[data-spot-id="${order[i].id}"] .route-order-badge`)).toHaveText(String(i + 1));
    }

    await page.click("#generate-mapbox-route");
    await expect(legs.nth(1)).toContainText("（目安）");
    await expect(page.locator(".route-order-badge")).toHaveCount(0);
});

test("地図上にルートを生成する時は船を除いて頼み、断られたら除かずに頼み直す。船の区間が残れば知らせる", async ({ page }) => {
    const [station, bridge] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
    await seed(page, {
        data: withSpots({
            course: { c1: { title_name: station.title_name, course_name: "川を渡る", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } }
        })
    });
    const line = [station, bridge].map((s) => [s.coord.longitude, s.coord.latitude]);
    const urls = [];
    await page.route(/\/directions\/v5\/mapbox\/walking\//, (route) => {
        const url = new URL(route.request().url());
        urls.push(url.searchParams.get("exclude"));
        if (url.searchParams.get("exclude") === "ferry") {
            return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ code: "InvalidInput", message: "no route" }) });
        }
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                code: "Ok",
                routes: [{
                    distance: 800,
                    duration: 600,
                    legs: [{ distance: 800, duration: 600, steps: [{ mode: "ferry", geometry: { type: "LineString", coordinates: line } }] }],
                    geometry: { type: "LineString", coordinates: line }
                }]
            })
        });
    });
    await page.goto("html/map.html?course=c1");
    await page.click("#generate-mapbox-route");
    await expect(page.locator("#toast")).toContainText("船の区間を含みます");
    expect(urls).toEqual(["ferry", null]);
});

test("地図上にルートを出している時に順番を入れ替えると、新しい順番でルートを作り直す。古い答えでは描かない", async ({ page }) => {
    const order = ["京阪宇治駅", "宇治橋", "大吉山展望台"].map(spotNamed);
    await seed(page, {
        data: withSpots({
            course: { c1: { title_name: order[0].title_name, course_name: "入れ替え", description: "", spot_ids: order.map((s) => s.id), updated_at: { __ts: 1 } } }
        })
    });
    const at = (s) => s.coord.longitude.toFixed(5);
    const requests = [];
    const pending = [];
    await page.route(/\/directions\/v5\/mapbox\/walking\//, (route) => {
        const coords = decodeURIComponent(new URL(route.request().url()).pathname.split("/walking/")[1]).split(";");
        requests.push(coords.map((c) => Number(c.split(",")[0]).toFixed(5)));
        const answer = () => route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                code: "Ok",
                routes: [{
                    distance: 1000 * requests.length,
                    duration: 600,
                    legs: coords.slice(1).map((c, i) => ({ distance: 500, duration: 300, steps: [{ geometry: { type: "LineString", coordinates: [coords[i], c].map((x) => x.split(",").map(Number)) } }] })),
                    geometry: { type: "LineString", coordinates: coords.map((x) => x.split(",").map(Number)) }
                }]
            })
        });
        // 2回目（入れ替え1回目）の答えは遅らせる
        if (requests.length === 2) pending.push(answer); else return answer();
    });
    await page.goto("html/map.html?course=c1");
    await page.click("#generate-mapbox-route");
    await expect(page.locator("#toast")).toContainText("ルートを生成しました");

    // 1番目を下へ（宇治橋, 京阪宇治駅, 大吉山）→ もう一度下へ（宇治橋, 大吉山, 京阪宇治駅）
    await page.locator('#routeList .routeItem[data-index="0"] .route-move button').nth(1).click();
    await expect.poll(() => requests.length).toBe(2);
    await page.locator('#routeList .routeItem[data-index="1"] .route-move button').nth(1).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[1]).toEqual([order[1], order[0], order[2]].map(at));
    expect(requests[2]).toEqual([order[1], order[2], order[0]].map(at));

    // 新しい順番の線が出たあとで、古い答えが届いても描き直さない
    await expect(page.locator("#toast")).toContainText("約3.0km");
    await pending[0]();
    await page.waitForTimeout(300);
    const last = await page.evaluate(() => window.__map.getSource("selected-spots-route")._data.features.at(-1).geometry.coordinates.at(-1)[0]);
    expect(last.toFixed(5)).toBe(at(order[0]));
    await expect(page.locator("#toast")).toContainText("約3.0km");
});

test("徒歩で1時間以上かかる区間は「○時間○分」で出す", async ({ page }) => {
    const [station, nagoya] = ["京阪宇治駅", "名古屋国際会議場（センチュリーホール）"].map(spotNamed);
    await seed(page, {
        data: withSpots({
            course: { c1: { title_name: station.title_name, course_name: "遠い", description: "", spot_ids: [station.id, nagoya.id], updated_at: { __ts: 1 } } }
        })
    });
    await page.route(/\/directions\/v5\/mapbox\/walking\//, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
            code: "Ok",
            routes: [{
                distance: 140000,
                duration: 100080,
                legs: [{ distance: 140000, duration: 100080 }],
                geometry: { type: "LineString", coordinates: [station, nagoya].map((s) => [s.coord.longitude, s.coord.latitude]) }
            }]
        })
    }));
    await page.goto("html/map.html?course=c1");
    const leg = page.locator("#routeList .route-leg").nth(1);
    // 目安（直線から）も時間と分
    await expect(leg).toHaveText(/^徒歩 約\d+\.\dkm・\d+時間(\d+分)?（目安・電車がおすすめ）/);

    await page.click("#generate-mapbox-route");
    await expect(page.locator("#toast")).toContainText("約140.0km・徒歩約27時間48分");
    await expect(leg).toHaveText(/^徒歩 約140\.0km・27時間48分（電車がおすすめ）/);
});

test("スマホの幅で、見ているピンが詳細パネルの下に来ても、パネルの上に出ない", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await seed(page);
    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(page.locator(".popup-meta")).toBeVisible();
    await page.waitForTimeout(1500);

    // 地図を動かして、ピンをパネルの真ん中あたりへ持っていく
    const pin = page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`);
    const panel = page.locator(".mapboxgl-popup:has(.popup-card)");
    const pinBox = await pin.boundingBox();
    const panelBox = await panel.boundingBox();
    const targetY = panelBox.y + panelBox.height / 2;
    await page.evaluate((dy) => window.__map.panBy([0, dy], { duration: 0 }), pinBox.y + pinBox.height / 2 - targetY);
    await page.waitForTimeout(300);

    const box = await pin.boundingBox();
    const onTop = await page.evaluate(([x, y]) => {
        const element = document.elementFromPoint(x, y);
        return element && element.closest(".mapboxgl-popup") ? "panel" : element && element.closest(".mapboxgl-marker") ? "pin" : "other";
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(onTop).toBe("panel");
});
