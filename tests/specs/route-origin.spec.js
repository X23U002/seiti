// 地図上のルート生成：現在地から歩くルートにする
import { test, expect, seed, withSpots, spotNamed } from "../helpers.js";

const station = spotNamed("京阪宇治駅");
const bridge = spotNamed("宇治橋");
// 京阪宇治駅の少し南（約300m）
const HERE = { latitude: station.coord.latitude - 0.0027, longitude: station.coord.longitude };

// Mapbox の徒歩ルートの代わり：頼まれた地点を順に結び、区間ごとに 500m・6分を返す
async function fakeDirections(page) {
    const requests = [];
    await page.route(/\/directions\/v5\/mapbox\/walking\//, (route) => {
        const url = new URL(route.request().url());
        const points = decodeURIComponent(url.pathname.split("/walking/")[1]).split(";").map((x) => x.split(",").map(Number));
        if (url.searchParams.get("steps") === "true") requests.push(points);
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                code: "Ok",
                routes: [{
                    distance: 500 * (points.length - 1),
                    duration: 360 * (points.length - 1),
                    legs: points.slice(1).map((point, i) => ({ distance: 500, duration: 360, steps: [{ geometry: { type: "LineString", coordinates: [points[i], point] } }] })),
                    geometry: { type: "LineString", coordinates: points }
                }]
            })
        });
    });
    return requests;
}

const oneSpot = (page) => seed(page, {
    data: withSpots({ course: { c1: { title_name: station.title_name, course_name: "1か所", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } } })
});

test.describe("現在地が分かる時", () => {
    test.use({ geolocation: HERE, permissions: ["geolocation"] });

    test("聖地が1か所でも、現在地から歩くルートを作り、「現在地から」の区間に道のりと時間を出す", async ({ page }) => {
        const requests = await fakeDirections(page);
        await seed(page);
        await page.goto("html/map.html?spot=" + station.id);
        await page.locator(".popup-card button[id^='route-btn-']").click();
        await page.evaluate(() => document.querySelector(".mapboxgl-popup-close-button")?.click());
        await expect(page.locator("#routeList .routeItem")).toHaveCount(1);

        await page.click("#generate-mapbox-route");
        await expect(page.locator("#toast")).toContainText("現在地からの道順を出しました（約0.5km・徒歩約6分）");
        expect(requests).toHaveLength(1);
        expect(requests[0]).toHaveLength(2);
        expect(requests[0][0][0]).toBeCloseTo(HERE.longitude, 5);
        expect(requests[0][0][1]).toBeCloseTo(HERE.latitude, 5);
        expect(requests[0][1][0]).toBeCloseTo(station.coord.longitude, 5);

        const first = page.locator("#routeList .route-leg").first();
        await expect(first).toHaveText(/^現在地から 徒歩 約500m・6分/);
        await expect(first).toHaveClass(/has-route-color/);
    });

    test("2か所以上の時も、現在地 → 1か所目 → 2か所目の順で作る", async ({ page }) => {
        const requests = await fakeDirections(page);
        await oneSpot(page);
        await page.goto("html/map.html?course=c1");
        await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
        await page.click("#generate-mapbox-route");
        await expect(page.locator("#toast")).toContainText("現在地からの道順を出しました（約1.0km");
        expect(requests[0]).toHaveLength(3);
        expect(requests[0][0][1]).toBeCloseTo(HERE.latitude, 5);
        expect(requests[0][2][1]).toBeCloseTo(bridge.coord.latitude, 5);
        const legs = page.locator("#routeList .route-leg");
        await expect(legs.nth(0)).toHaveText(/^現在地から 徒歩/);
        await expect(legs.nth(1)).toHaveText(/^徒歩 約500m・6分/);
    });
});

test.describe("「現在地から」を外す", () => {
    test.use({ geolocation: HERE, permissions: ["geolocation"] });

    test("× で外すと 1か所目から出発し（地図の道順も Googleマップも）、開き直しても覚えている。＋ で戻せる", async ({ page }) => {
        const requests = await fakeDirections(page);
        await page.addInitScript(() => { window.open = (url) => { window.__opened = url; return null; }; });
        await oneSpot(page);
        await page.goto("html/map.html?course=c1");
        await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
        const first = page.locator("#routeList .route-leg").first();
        await expect(first).toHaveText(/^現在地から/);

        await first.locator(".route-origin-remove").click();
        await expect(page.locator("#toast")).toContainText("1か所目から出発します");
        await expect(page.locator("#routeList .route-leg").first()).toHaveText("＋ 現在地から出発する");

        // 地図の道順は 1か所目 → 2か所目（現在地は入れない）
        await page.click("#generate-mapbox-route");
        await expect(page.locator("#toast")).toContainText("道順を出しました（約0.5km");
        await expect(page.locator("#toast")).not.toContainText("現在地から");
        expect(requests.at(-1)).toHaveLength(2);
        expect(requests.at(-1)[0][1]).toBeCloseTo(station.coord.latitude, 5);

        // Googleマップも 1か所目から出発する
        await page.click("#open-google-route");
        const opened = new URL(await page.evaluate(() => window.__opened));
        expect(opened.searchParams.get("origin")).toBe(`${station.coord.latitude},${station.coord.longitude}`);
        expect(opened.searchParams.get("destination")).toBe(`${bridge.coord.latitude},${bridge.coord.longitude}`);
        expect(opened.searchParams.get("waypoints")).toBeNull();

        // 開き直しても外したまま
        await page.reload();
        await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
        await expect(page.locator("#routeList .route-leg").first()).toHaveText("＋ 現在地から出発する");

        // ＋ で戻すと、また現在地から（道順を出していれば出し直す）
        await page.click("#generate-mapbox-route");
        await expect(page.locator("#toast")).toContainText("道順を出しました");
        await page.locator("#routeList .route-origin-add").click();
        await expect.poll(() => requests.at(-1).length).toBe(3);
        expect(requests.at(-1)[0][1]).toBeCloseTo(HERE.latitude, 5);
        await expect(page.locator("#routeList .route-leg").first()).toHaveText(/^現在地から 徒歩/);
    });
});

test.describe("現在地が1か所目から遠い時", () => {
    test.use({ geolocation: { latitude: 35.6812, longitude: 139.7671 }, permissions: ["geolocation"] });

    test("現在地は使わず、1か所目から作る。1か所だけなら作れないと知らせる", async ({ page }) => {
        const requests = await fakeDirections(page);
        await oneSpot(page);
        await page.goto("html/map.html?course=c1");
        await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
        await page.click("#generate-mapbox-route");
        await expect(page.locator("#toast")).toContainText("道順を出しました（約0.5km");
        await expect(page.locator("#toast")).not.toContainText("現在地から");
        expect(requests[0]).toHaveLength(2);

        await page.locator('#routeList .routeItem[data-index="1"] .route-remove').click();
        await expect(page.locator("#toast")).toContainText("現在地から遠いため、ルートを作れません");
        // 消した聖地を通るルートは残さない
        expect(await page.evaluate(() => window.__map.getSource("selected-spots-route")._data.features)).toEqual([]);
        await expect(page.locator("#generate-mapbox-route")).toHaveText("🚶 道順を地図に出す");
        await expect(page.locator("#generate-mapbox-route")).toBeEnabled();
    });
});
