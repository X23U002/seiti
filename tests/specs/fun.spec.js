// 使っていて楽しくなる動き：バッジ獲得の演出・スタンプ帳で新しいスタンプが押される・
// 3D キャラクターが跳ねる・歩き終えたルートの区間を塗る
import fs from "node:fs";
import path from "node:path";
import { test, expect, seed, withSpots, spotNamed, PROFILE } from "../helpers.js";

const station = spotNamed("京阪宇治駅");
const bridge = spotNamed("宇治橋");
const member = (other = {}) => withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") }, ...other });
const mine = (spot, ms) => ({ user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + spot.id }, time_stamp: { __ts: ms }, position: spot.coord });

test("スタンプで新しくもらえたバッジを、スタンプのお祝いの中に出す（もう持っているバッジは出さない）", async ({ page }) => {
    await seed(page, { user: "uid2", data: member() });
    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(page.locator(".popup-card .stamp-button")).toBeVisible();
    await page.waitForFunction(() => !localStorage.getItem("osikatumap-stamp-history-v2"));

    // 初めてのスタンプ → 「はじめの一歩」
    await page.evaluate((id) => window.setStampTestLocation(id, 10), bridge.id);
    await page.evaluate((id) => window.collectStamp(id), bridge.id);
    const badges = page.locator(".stamp-celebration .stamp-celebration-badges");
    await expect(badges).toContainText("バッジを獲得");
    await expect(badges.locator(".new-badge", { hasText: "はじめの一歩" })).toBeVisible();
    await page.locator(".stamp-celebration-close").click();

    // 2か所目では「はじめの一歩」はもう出さない
    await page.goto("html/map.html?spot=" + station.id);
    await expect(page.locator(".popup-card .stamp-button")).toBeVisible();
    await page.evaluate((id) => window.setStampTestLocation(id, 10), station.id);
    await page.evaluate((id) => window.collectStamp(id), station.id);
    await expect(page.locator(".stamp-celebration")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator(".new-badge", { hasText: "はじめの一歩" })).toHaveCount(0);
});

test("スタンプ帳では、前に開いた時から新しく取ったスタンプだけを、押される動きと NEW で出す", async ({ page }) => {
    await seed(page, { user: "uid2", data: member({ stamp: { a: mine(station, Date.UTC(2026, 10, 1)) } }) });
    // 初めて開いた時は、全部を新しいことにはしない
    await page.goto("html/stamp.html");
    await expect(page.locator(".stamp-item:not(.is-locked)")).toHaveCount(1);
    await expect(page.locator(".stamp-item.is-new")).toHaveCount(0);

    // 宇治橋のスタンプを取ってから開き直す
    await page.evaluate((spotId) => {
        const store = JSON.parse(localStorage.getItem("mockFs"));
        store.stamp.b = { user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + spotId }, time_stamp: { __ts: Date.now() } };
        localStorage.setItem("mockFs", JSON.stringify(store));
    }, bridge.id);
    await page.reload();
    const fresh = page.locator(".stamp-item.is-new");
    await expect(fresh).toHaveCount(1);
    await expect(fresh).toContainText(bridge.spot_name);
    await expect(fresh).toHaveClass(/is-pressing/);
    await expect(fresh.locator(".stamp-new-label")).toHaveText("NEW");

    // たたむ・開くで描き直しても、押される動きは繰り返さない
    await page.locator(".only-earned").click();
    await expect(page.locator(".stamp-item.is-new")).not.toHaveClass(/is-pressing/);

    // もう一度開くと、もう新しくない
    await page.reload();
    await expect(page.locator(".stamp-item:not(.is-locked)")).toHaveCount(2);
    await expect(page.locator(".stamp-item.is-new")).toHaveCount(0);
});

test.describe("ルートの道順を出して歩く", () => {
    // 京阪宇治駅の少し南（約300m）
    const HERE = { latitude: station.coord.latitude - 0.0027, longitude: station.coord.longitude };
    test.use({ geolocation: HERE, permissions: ["geolocation"] });

    test("聖地に着くと、そこまでの区間を太く塗り（歩き終えた区間）、キャラクターに着いたことを知らせる", async ({ page, context }) => {
        // Mapbox の徒歩ルートの代わり：頼まれた地点を順に結ぶ
        await page.route(/\/directions\/v5\/mapbox\/walking\//, (route) => {
            const url = new URL(route.request().url());
            const points = decodeURIComponent(url.pathname.split("/walking/")[1]).split(";").map((x) => x.split(",").map(Number));
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
        await page.addInitScript(() => {
            window.__arrived = [];
            window.addEventListener("seiti:spot-arrived", (event) => window.__arrived.push(event.detail.spotId));
        });
        await seed(page, {
            data: withSpots({ course: { c1: { title_name: station.title_name, course_name: "2か所", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } } })
        });
        await page.goto("html/map.html?course=c1");
        await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
        await page.click("#generate-mapbox-route");
        await expect(page.locator("#toast")).toContainText("道順を出しました");
        // 現在地ボタンで、現在地を追いかけ始める
        await page.click("#location-btn");
        await expect(page.locator(".mapboxgl-user-location-dot").first()).toBeAttached();
        // まだどこにも着いていない
        await expect(page.locator("#map")).toHaveAttribute("data-route-done", "");

        // 1か所目（現在地 → 京阪宇治駅 の区間を塗る）
        await context.setGeolocation({ latitude: station.coord.latitude, longitude: station.coord.longitude });
        await expect(page.locator("#map")).toHaveAttribute("data-route-done", "0");
        await expect.poll(() => page.evaluate(() => window.__arrived)).toEqual([station.id]);
        expect(await page.evaluate(() => window.__map.getSource("selected-spots-route-done")._data.features.length)).toBe(1);

        // 2か所目（京阪宇治駅 → 宇治橋 の区間も塗る）
        await context.setGeolocation({ latitude: bridge.coord.latitude, longitude: bridge.coord.longitude });
        await expect(page.locator("#map")).toHaveAttribute("data-route-done", "0,1");
        await expect.poll(() => page.evaluate(() => window.__arrived)).toEqual([station.id, bridge.id]);

        // 道順を消すと、塗った線も消す
        await page.click("#generate-mapbox-route");
        await expect(page.locator("#map")).toHaveAttribute("data-route-done", "");
    });
});

test.describe("3D キャラクター（three.js を使う）", () => {
    const THREE_DIR = process.env.THREE_DIR;
    test.skip(!THREE_DIR, "three.js の場所（THREE_DIR）が無い");
    test.use({ geolocation: { latitude: bridge.coord.latitude, longitude: bridge.coord.longitude, accuracy: 10 }, permissions: ["geolocation"], motion: "no-preference" });

    test("スタンプを取ると、3D キャラクターがぴょんと跳ねる", async ({ page }) => {
        await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)/, (route) => {
            const rel = route.request().url().replace(/.*\/npm\/three@[^/]+\//, "").split("?")[0];
            const file = path.join(THREE_DIR, rel);
            if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
            return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: fs.readFileSync(file) });
        });
        await seed(page, { user: "uid2", data: member() });
        await page.goto("html/map.html?spot=" + bridge.id);
        await page.waitForFunction(() => window.__map && window.__map.loaded());
        await page.evaluate(() => window.toggleView());
        await expect(page.locator("#map")).toHaveClass(/walker-active/, { timeout: 30000 });
        await expect(page.locator(".popup-card .stamp-button")).toBeVisible();
        await page.waitForFunction(() => !localStorage.getItem("osikatumap-stamp-history-v2"));

        await page.evaluate((id) => window.setStampTestLocation(id, 10), bridge.id);
        await page.evaluate((id) => window.collectStamp(id), bridge.id);
        await expect(page.locator(".stamp-celebration")).toBeVisible();
        await expect(page.locator("#map")).toHaveAttribute("data-walker-jumps", "1");
    });
});
