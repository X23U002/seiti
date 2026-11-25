// テスト設計書（テスト設計書_聖地巡礼NAVI.xlsx）のうち、ほかの自動テストに無かった項目
// テストの名前の先頭の TC-xxx が、設計書の No。3D の項目は THREE_DIR（three.js の場所）がある時だけ動かす
import { test, expect, seed, withSpots, spotNamed, readStore, PROFILE, SPOTS } from "../helpers.js";
import fs from "node:fs";
import path from "node:path";

const THREE_DIR = process.env.THREE_DIR;
const pins = (page) => page.locator(".mapboxgl-marker[data-spot-id]");
const bridge = spotNamed("宇治橋");
const station = spotNamed("京阪宇治駅");
const EUPHO = bridge.title_name;
const member = (other = {}) => withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") }, ...other });
const MEMBER = { user: "uid2", users: { "p@x.jp": { uid: "uid2", password: "password1" } } };

// 3D 表示の部品（three.js）を、テスト用に入れたものから読む
async function serveThree(page) {
    await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)/, (route) => {
        const rel = route.request().url().replace(/.*\/npm\/three@[^/]+\//, "").split("?")[0];
        const file = path.join(THREE_DIR, rel);
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: fs.readFileSync(file) });
    });
}

// 地図に出ている聖地の数（ピン・まとめの丸の数字・点を足す）
const shownCount = (page) => page.evaluate(() => {
    let total = 0;
    document.querySelectorAll(".mapboxgl-marker").forEach((el) => {
        if (el.dataset.spotId) total += 1;
        else if (el.classList.contains("spot-cluster")) total += Number(el.textContent.trim()) || 0;
        else if (el.classList.contains("spot-dot")) total += 1;
    });
    return total;
});

async function openMap(page, url = "html/map.html") {
    await page.goto(url);
    await page.waitForFunction(() => window.__map && window.__map.loaded());
}

test("TC-002 画面下のタブ：押した画面へ移り、今いる画面のタブが濃い色になる", async ({ page }) => {
    await seed(page, { ...MEMBER, data: member() });
    await page.goto("html/map.html");
    for (const [name, url] of [["作品一覧", /works\.html/], ["スタンプ帳", /stamp\.html/], ["マイページ", /mypage\.html/], ["地図", /map\.html/]]) {
        await page.locator(".tab-bar a", { hasText: name }).click();
        await expect(page).toHaveURL(url);
        const current = page.locator('.tab-bar a[aria-current="page"]');
        await expect(current).toHaveText(new RegExp(name));
        const other = page.locator('.tab-bar a:not([aria-current="page"])').first();
        const [a, b] = await Promise.all([current, other].map((el) => el.evaluate((e) => getComputedStyle(e).color)));
        expect(a).not.toBe(b);
    }
});

test("TC-003 上の戻るボタン：お気に入り・履歴の「＜ マイページ」が見出しと重ならない", async ({ page }) => {
    await seed(page, { ...MEMBER, data: member() });
    await page.goto("html/history.html");
    const back = await page.locator(".back-btn").boundingBox();
    const title = await page.locator(".app-header h1").boundingBox();
    expect(back.x + back.width <= title.x || title.x + title.width <= back.x).toBe(true);
});

test("TC-004 ホーム画面に追加：全画面で開くための情報（standalone・アイコン）がある", async ({ page, request }) => {
    await seed(page);
    await page.goto("html/map.html");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await request.get(new URL(href, page.url()).toString())).json();
    expect(["standalone", "fullscreen"]).toContain(manifest.display);
    for (const icon of manifest.icons) {
        const res = await request.get(new URL(icon.src, new URL(href, page.url())).toString());
        expect(res.ok()).toBe(true);
    }
});

test("TC-007 移動・拡大縮小：ドラッグで動き、ホイールで拡大・縮小できる", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 });
    await seed(page);
    await openMap(page);
    const before = await page.evaluate(() => window.__map.getCenter().toArray());
    await page.mouse.move(550, 400);
    await page.mouse.down();
    await page.mouse.move(400, 300, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__map.getCenter().toArray())).not.toEqual(before);

    const zoom = await page.evaluate(() => window.__map.getZoom());
    await page.mouse.move(550, 400);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => page.evaluate(() => window.__map.getZoom())).toBeGreaterThan(zoom + 0.3);
    const zoomIn = await page.evaluate(() => window.__map.getZoom());
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => window.__map.getZoom())).toBeLessThan(zoomIn - 0.3);
});

test.describe("位置情報を許可しない時", () => {
    test.use({ permissions: [] });
    test("TC-010 現在地ボタンを押してもエラーで止まらず、地図はそのまま使える", async ({ page, context }) => {
        await context.clearPermissions();
        await seed(page);
        await openMap(page);
        await page.evaluate(() => {
            navigator.geolocation.getCurrentPosition = (_ok, ng) => setTimeout(() => ng({ code: 1, message: "denied", PERMISSION_DENIED: 1 }), 10);
            navigator.geolocation.watchPosition = (_ok, ng) => { setTimeout(() => ng({ code: 1, message: "denied", PERMISSION_DENIED: 1 }), 10); return 1; };
        });
        await page.click("#location-btn");
        await page.waitForTimeout(800);
        // 地図はそのまま動かせ、ピンも押せる
        await expect(pins(page)).toHaveCount(SPOTS.length);
        await page.evaluate(() => window.__map.jumpTo({ zoom: 13 }));
        expect(await page.evaluate(() => window.__map.getZoom())).toBeCloseTo(13, 1);
    });
});

test.describe("3D 表示（three.js を使う）", () => {
    test.skip(!THREE_DIR, "three.js の場所（THREE_DIR）が無い");

    test("TC-011 2D／3D の切りかえ：3D で傾いて立体のピンになり、2D で真上に戻る", async ({ page }) => {
        await serveThree(page);
        await seed(page);
        await openMap(page);
        await page.click("#toggle-view-btn");
        await expect.poll(() => page.evaluate(() => window.__map.getPitch())).toBeGreaterThan(30);
        // 建物を立体にする設定（Mapbox Standard の 3D の建物）・立体のピンの画面
        await expect(page.locator("canvas").nth(1)).toBeAttached({ timeout: 20000 });
        await expect.poll(() => page.evaluate(() => document.querySelectorAll("#map canvas").length), { timeout: 20000 }).toBeGreaterThan(1);
        await page.click("#toggle-view-btn");
        await expect.poll(() => page.evaluate(() => window.__map.getPitch())).toBe(0);
    });

    test("TC-013 3D で向き・角度を変える：右ボタンのドラッグで向きと傾きが変わる。指の操作も有効", async ({ page }) => {
        await page.setViewportSize({ width: 1100, height: 760 });
        await serveThree(page);
        await seed(page);
        await openMap(page);
        await page.click("#toggle-view-btn");
        await expect.poll(() => page.evaluate(() => window.__map.getPitch())).toBeGreaterThan(30);
        await page.waitForTimeout(800);
        const [bearing, pitch] = await page.evaluate(() => [window.__map.getBearing(), window.__map.getPitch()]);
        await page.mouse.move(550, 400);
        await page.mouse.down({ button: "right" });
        await page.mouse.move(700, 300, { steps: 12 });
        await page.mouse.up({ button: "right" });
        await expect.poll(() => page.evaluate(() => window.__map.getBearing())).not.toBeCloseTo(bearing, 0);
        expect(await page.evaluate(() => window.__map.getPitch())).not.toBeCloseTo(pitch, 0);
        // スマホの2本指（ひねる・上下になぞる）も有効
        expect(await page.evaluate(() => [window.__map.touchZoomRotate.isEnabled(), window.__map.touchPitch.isEnabled()])).toEqual([true, true]);
    });

    test("TC-016 3D の立体のピンを押すと詳細が開き、押したピンが強調される", async ({ page }) => {
        await serveThree(page);
        await seed(page);
        await openMap(page);
        await page.click("#toggle-view-btn");
        await expect.poll(() => page.evaluate(() => window.__map.getPitch())).toBeGreaterThan(30);
        await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat], zoom: 16, bearing: 0 }), [bridge.coord.longitude, bridge.coord.latitude]);
        // 2D のピンが隠れて、立体のピンに置きかわるのを待つ
        await expect.poll(() => page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`).evaluate((el) => getComputedStyle(el).visibility), { timeout: 20000 }).toBe("hidden");
        await page.waitForTimeout(1500);
        const point = await page.evaluate(([lng, lat]) => window.__map.project([lng, lat]), [bridge.coord.longitude, bridge.coord.latitude]);
        await page.mouse.click(point.x, point.y - 25);
        await expect(page.locator(".popup-spot")).toContainText(bridge.spot_name);
        await expect(page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`)).toHaveClass(/is-selected/);
        // 2D のピンは出てこない
        expect(await page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`).evaluate((el) => getComputedStyle(el).visibility)).toBe("hidden");
    });
});

test.describe("3D 表示の重なったピン（three.js を使う）", () => {
    test.skip(!THREE_DIR, "three.js の場所（THREE_DIR）が無い");

    test("TC-032（3D）まとめたピンの立体のピンを押すと「この場所の聖地」の一覧が出て、選ぶと詳細が開く", async ({ page }) => {
        // 東京ドーム（【推しの子】と 超かぐや姫！）
        const [oshi, kaguya] = SPOTS.filter((spot) => spot.spot_name === "東京ドーム");
        await serveThree(page);
        await seed(page);
        await openMap(page);
        await page.click("#toggle-view-btn");
        await expect.poll(() => page.evaluate(() => window.__map.getPitch())).toBeGreaterThan(30);
        await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat], zoom: 16, bearing: 0 }), [oshi.coord.longitude, oshi.coord.latitude]);
        const group = page.locator(`.overlap-pin[data-group-key="group:${[oshi.id, kaguya.id].sort().join(",")}"]`);
        // 2D のまとめたピンが隠れて、立体のピンに置きかわるのを待つ
        await expect.poll(() => group.evaluate((el) => getComputedStyle(el.closest(".mapboxgl-marker") || el).visibility), { timeout: 20000 }).toBe("hidden");
        await page.waitForTimeout(1500);
        const point = await page.evaluate((key) => {
            const marker = document.querySelector(`.mapboxgl-marker[data-group-key="${key}"]`) || document.querySelector(`[data-group-key="${key}"]`).closest(".mapboxgl-marker");
            const rect = marker.getBoundingClientRect();
            const map = window.__map.getContainer().getBoundingClientRect();
            return { x: rect.left + rect.width / 2 - map.left, y: rect.bottom - map.top };
        }, `group:${[oshi.id, kaguya.id].sort().join(",")}`);
        await page.mouse.click(point.x, point.y - 25);

        const list = page.locator(".overlap-list");
        await expect(list.locator(".overlap-list-title")).toHaveText("この場所の聖地（2か所）");
        // 少し待っても消えない
        await page.waitForTimeout(500);
        await expect(list).toBeVisible();
        await list.locator(".overlap-list-item", { hasText: "超かぐや姫！" }).click();
        await expect(page.locator(".popup-card .popup-title")).toHaveText("超かぐや姫！");
    });
});

test("TC-015 縮小した時のまとめ：数字の丸にまとまり、押すと拡大。点を押すと詳細が開く", async ({ page }) => {
    await seed(page);
    await openMap(page);
    await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat], zoom: 9 }), [bridge.coord.longitude, bridge.coord.latitude]);
    const cluster = page.locator(".spot-cluster", { hasText: String(SPOTS.filter((s) => s.title_name === EUPHO).length - 1) }).filter({ has: page.locator(".spot-cluster-count") }).first();
    await expect(cluster).toBeVisible();
    await expect(cluster.locator(".spot-cluster-count")).toHaveText(/\d+/);
    await cluster.click();
    await expect.poll(() => page.evaluate(() => window.__map.getZoom())).toBeGreaterThanOrEqual(11);

    // 1か所だけの所（点）へ地図を動かして押す
    await page.evaluate(() => window.__map.jumpTo({ zoom: 9 }));
    const dotSpot = await page.evaluate(() => {
        const dot = document.querySelector(".spot-dot");
        return dot ? true : false;
    });
    expect(dotSpot).toBe(true);
    const target = await page.evaluate(() => {
        const dot = document.querySelector(".spot-dot");
        const marker = [...document.querySelectorAll(".mapboxgl-marker")].indexOf(dot);
        return marker;
    });
    expect(target).toBeGreaterThanOrEqual(0);
    await page.evaluate(() => {
        // 点の場所を地図の真ん中にする
        const dot = document.querySelector(".spot-dot");
        const rect = dot.getBoundingClientRect();
        const map = window.__map;
        const lngLat = map.unproject([rect.left + rect.width / 2 - map.getContainer().getBoundingClientRect().left, rect.top + rect.height / 2 - map.getContainer().getBoundingClientRect().top]);
        map.jumpTo({ center: lngLat });
    });
    await page.locator(".spot-dot").first().click();
    await expect(page.locator(".popup-spot")).toBeVisible();
});

test("TC-022 画像がない聖地：「画像はまだありません」と出て、くずれない", async ({ page }) => {
    const data = withSpots();
    delete data.spot[bridge.id].image_url;
    await seed(page, { data });
    await page.goto("html/map.html?spot=" + bridge.id);
    const box = page.locator(".popup-image.no-image");
    await expect(box).toBeVisible();
    expect(await box.evaluate((el) => getComputedStyle(el, "::after").content)).toContain("画像はまだありません");
    await expect(page.locator(".popup-spot")).toBeVisible();
    const card = await page.locator(".popup-card").boundingBox();
    expect(card.width).toBeLessThanOrEqual(390);
});

test("TC-023 作品名の札を押すと作品ページが開く", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html?spot=" + bridge.id);
    await page.locator("a.popup-title").click();
    await expect(page).toHaveURL(/work\.html\?title=/);
    await expect(page.locator("#work-title")).toHaveText(EUPHO);
});

test("TC-024 公式サイト：🌐 で作品の公式サイトが別のタブで開く", async ({ page }) => {
    const spot = SPOTS.find((s) => /^https?:/.test(s.title_url || ""));
    await seed(page);
    await page.goto("html/map.html?spot=" + spot.id);
    const home = page.locator(".popup-home");
    await expect(home).toHaveAttribute("href", spot.title_url);
    await expect(home).toHaveAttribute("target", "_blank");
});

test("TC-025 お気に入り：♡ で入り、マイページのお気に入りに出る。もう一度で外れる", async ({ page }) => {
    await seed(page, { ...MEMBER, data: member() });
    await page.goto("html/map.html?spot=" + bridge.id);
    const fav = page.locator(".popup-fav");
    await fav.click();
    await expect(fav).toHaveAttribute("aria-pressed", "true");
    expect(await fav.evaluate((el) => getComputedStyle(el.querySelector("svg")).fill)).not.toBe("none");
    await expect.poll(async () => Object.keys((await readStore(page)).favorite || {}).length).toBe(1);

    await page.goto("html/history.html");
    await expect(page.locator("#count-favorites")).toHaveText("1");
    await expect(page.locator("#panel-favorites")).toContainText(bridge.spot_name);

    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(fav).toHaveAttribute("aria-pressed", "true");
    await fav.click();
    await expect(fav).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => Object.keys((await readStore(page)).favorite || {}).length).toBe(0);
});

test("TC-026 お気に入り（未ログイン）：ログインするボタン付きで知らせる", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html?spot=" + bridge.id);
    await page.locator(".popup-fav").click();
    await expect(page.locator("#toast")).toContainText("お気に入りはログインすると使えます");
    await expect(page.locator("#toast .toast-action")).toHaveText("ログインする");
});

test("TC-027 共有：共有メニューでこの聖地のリンクを送れ、開くと詳細が開く", async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => { navigator.share = async (data) => { window.__shared = data; }; });
    await page.goto("html/map.html?spot=" + bridge.id);
    await page.locator(".popup-share").click();
    const shared = await page.waitForFunction(() => window.__shared).then((h) => h.jsonValue());
    expect(shared.url).toContain("spot=" + encodeURIComponent(bridge.id));
    await page.goto(new URL(shared.url).pathname.replace(/^.*\/html\//, "html/") + new URL(shared.url).search);
    await expect(page.locator(".popup-spot")).toContainText(bridge.spot_name);
});

test("TC-028 詳細のおすすめルートを押すとルート案内に入る", async ({ page }) => {
    await seed(page, { data: withSpots({ course: { c1: { title_name: EUPHO, course_name: "宇治をめぐる", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } } }) });
    await page.goto("html/map.html?spot=" + bridge.id);
    const course = page.locator(".popup-courses .course-start").first();
    await expect(course).toContainText("宇治をめぐる");
    await course.click();
    await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
});

test("TC-035 作品で絞り込み：選んだ作品だけ。× で外れ、リセットで全部に戻る", async ({ page }) => {
    await seed(page);
    await openMap(page);
    await page.click("#filter-btn");
    await page.locator(`#anime-list .anime-item[data-title="${EUPHO}"] input[type=checkbox]`).check();
    await page.click("#filter-ok");
    const count = SPOTS.filter((s) => s.title_name === EUPHO).length;
    await expect.poll(() => shownCount(page)).toBe(count);
    await page.locator("#filter-chips .filter-chip").click();
    await expect.poll(() => shownCount(page)).toBe(SPOTS.length);

    await page.click("#filter-btn");
    await page.locator(`#anime-list .anime-item[data-title="${EUPHO}"] input[type=checkbox]`).check();
    await page.click("#filter-ok");
    await expect.poll(() => shownCount(page)).toBe(count);
    await page.click("#filter-btn");
    await page.click("#filter-reset");
    if (await page.locator("#filter-ok").isVisible()) await page.click("#filter-ok");
    await expect.poll(() => shownCount(page)).toBe(SPOTS.length);
    await expect(page.locator("#filter-chips .filter-chip")).toHaveCount(0);
});

test.describe("聖地の近く", () => {
    test.use({ geolocation: { latitude: bridge.coord.latitude, longitude: bridge.coord.longitude, accuracy: 10 }, permissions: ["geolocation"] });

    test("TC-039 スタンプを取る：ピンに ✓ が付き、スタンプ帳に記録される", async ({ page }) => {
        await seed(page, { ...MEMBER, data: member() });
        await page.goto("html/map.html?spot=" + bridge.id);
        const button = page.locator(".stamp-button");
        await button.click(); // 📍 現在地を確かめる（ブラウザの位置情報の上書きで、宇治橋の上にいる）
        await expect(button).toHaveText("🎫 スタンプを取得");
        await button.click();
        await expect(page.locator(".stamp-celebration")).toBeVisible();
        await expect(page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`)).toHaveClass(/stamp-completed-marker/);
        await page.goto("html/stamp.html");
        await expect(page.locator(".stamp-item:not(.is-locked)")).toContainText([bridge.spot_name]);
    });

    test("TC-042 続けて取る：待ち時間が出る。何度も取ると枠の色（ランク）が変わる", async ({ page }) => {
        const mine = (i) => ({ user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + bridge.id }, time_stamp: { __ts: Date.UTC(2026, 9, 1 + i) }, position: bridge.coord });
        await seed(page, { ...MEMBER, data: member({ stamp: { a: mine(0), b: mine(1) } }) });
        await page.goto("html/map.html?spot=" + bridge.id);
        const button = page.locator(".stamp-button");
        await button.click(); // 📍 現在地を確かめる
        await expect(button).toHaveText("🎫 スタンプを取得");
        await button.click();
        await expect(page.locator(".stamp-celebration")).toBeVisible();
        await page.evaluate(() => document.querySelector(".stamp-celebration")?.remove());
        await expect(button).toHaveText(/⏳ あと/);
        await expect(button).toBeDisabled();
        // 3回でシルバーになる（スタンプ帳）
        await page.goto("html/stamp.html");
        await expect(page.locator(".stamp-item", { hasText: bridge.spot_name })).toHaveAttribute("aria-label", /シルバー・3回/);
    });
});

test("TC-044 ルートに追加すると、ピンに順番の番号が付く", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html?spot=" + bridge.id);
    await page.locator(".popup-card button[id^='route-btn-']").click();
    await expect(page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"] .route-order-badge`)).toHaveText("1");
});

test("TC-050 ルートを保存：保存ルートに出て、「地図で開く」でルート案内に入る", async ({ page }) => {
    await seed(page, { ...MEMBER, data: member({ course: { c1: { title_name: EUPHO, course_name: "c", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } } }) });
    await page.goto("html/map.html?course=c1");
    await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
    await page.click("#save-route");
    await expect(page.locator("#toast")).toContainText("ルートを保存しました");
    await page.goto("html/history.html");
    await page.click("#tab-routes");
    await expect(page.locator("#count-routes")).toHaveText("1");
    const panel = page.locator("#panel-routes");
    await expect(panel).toContainText(bridge.spot_name);
    await panel.locator("a", { hasText: "地図で開く" }).first().click();
    await expect(page).toHaveURL(/map\.html/);
    await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
});

test("TC-056 作品一覧：聖地の数・おすすめルートの数・スタンプの進み具合が出て、名前で探せる", async ({ page }) => {
    await seed(page, { ...MEMBER, data: member({ course: { c1: { title_name: EUPHO, course_name: "c", description: "", spot_ids: [bridge.id], updated_at: { __ts: 1 } } } }) });
    await page.goto("html/works.html");
    const card = page.locator(".work-card", { hasText: EUPHO });
    await expect(card).toContainText(/聖地 \d+か所/);
    await expect(card).toContainText("おすすめルート 1本");
    await expect(card).toContainText(/スタンプ 0 \/ \d+/);
    await page.fill("#work-search", "ユーフォ");
    await expect(page.locator(".work-card h2")).toHaveText([EUPHO]);
});

test("TC-059 作品ページ：地図でこの作品の聖地を見る・このルートで巡る", async ({ page }) => {
    await seed(page, { data: withSpots({ course: { c1: { title_name: EUPHO, course_name: "宇治をめぐる", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } } }) });
    await page.goto("html/work.html?title=" + encodeURIComponent(EUPHO));
    await page.locator("a, button", { hasText: "地図でこの作品の聖地を見る" }).first().click();
    await expect(page).toHaveURL(/map\.html\?work=/);
    const count = SPOTS.filter((s) => s.title_name === EUPHO).length;
    await expect.poll(() => shownCount(page)).toBe(count);

    await page.goto("html/work.html?title=" + encodeURIComponent(EUPHO));
    await page.locator("a, button", { hasText: "このルートで巡る" }).first().click();
    await expect(page).toHaveURL(/map\.html/);
    await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
});

test("TC-060 スタンプ帳：作品を切りかえられ、獲得済みだけにできる", async ({ page }) => {
    const mine = { user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + bridge.id }, time_stamp: { __ts: Date.UTC(2026, 10, 1) } };
    await seed(page, { ...MEMBER, data: member({ stamp: { t1: mine } }) });
    await page.goto("html/stamp.html");
    await expect(page.locator("#got-count")).toHaveText("1");
    await expect(page.locator(".stamp-item.is-locked").first()).toContainText("?");
    // 作品を切りかえる
    await page.locator("#title-picker-btn, .title-picker, [aria-controls='title-picker']").first().click();
    await page.locator(".title-option, [role=option]", { hasText: EUPHO }).first().click();
    await expect(page.locator(".stamp-section")).toHaveCount(1);
    await expect(page.locator(".stamp-section h2")).toContainText(EUPHO);
    // 獲得済みだけ
    await page.locator(".only-earned").click();
    await expect(page.locator(".stamp-item")).toHaveCount(1);
});

test("TC-061 マイページ：名前・アイコン・獲得スタンプ数・作品数・達成率・バッジが出る", async ({ page }) => {
    const mine = { user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + bridge.id }, time_stamp: { __ts: Date.UTC(2026, 10, 1) } };
    await seed(page, { ...MEMBER, data: member({ stamp: { t1: mine } }) });
    await page.goto("html/mypage.html");
    await expect(page.locator("#current-name")).toHaveText("巡礼者");
    await expect(page.locator("#current-icon")).not.toBeEmpty();
    await expect(page.locator("#current-user-id")).toHaveText("p@x.jp");
    await expect(page.locator("#stamp-count")).toHaveText("1");
    await expect(page.locator("#anime-count")).toHaveText("1");
    await expect(page.locator("#progress-rate")).toHaveText(/\d+/);
    await expect(page.locator("#badge-list .badge-item.is-earned")).not.toHaveCount(0);
});

test("TC-062 プロフィール編集：名前やアイコンを変えるとマイページに反映される", async ({ page }) => {
    await seed(page, { ...MEMBER, data: member() });
    await page.goto("html/mypage.html");
    await expect(page.locator("#current-name")).toHaveText("巡礼者");
    await page.locator(".edit-profile-btn").click();
    await page.fill("#edit-name-input", "あたらしい名前");
    await page.locator(".icon-option", { hasText: "🐱" }).click();
    await page.click("#save-profile-btn");
    await expect(page.locator("#current-name")).toHaveText("あたらしい名前");
    await expect(page.locator("#current-icon")).toContainText("🐱");
    await page.reload();
    await expect(page.locator("#current-name")).toHaveText("あたらしい名前");
});

test("TC-065 新規登録：入力が足りないとエラー。確認画面で登録するとログインした状態になる", async ({ page }) => {
    await seed(page);
    await page.goto("html/newaccount.html");
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/newaccount\.html/);
    await expect(page.locator(".field-error:visible, [role=alert]:visible, .error:visible, #nickname-hint, #password-hint").first()).toBeVisible();

    await page.fill("#nickname", "しんき");
    await page.fill("#email", "new@x.jp");
    await page.fill("#password", "abcdefg123");
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/confirm\.html/);
    await expect(page.locator("#confirm-nickname")).toHaveText("しんき");
    await page.click("#register-btn");
    await expect(page.locator("#complete-modal")).toBeVisible();
    const auth = await page.evaluate(() => JSON.parse(localStorage.getItem("mockAuth")));
    expect(auth.current).toBeTruthy();
    expect(auth.users["new@x.jp"]).toBeTruthy();
});

test("TC-066 ログイン・ログアウト：間違ったパスワードはエラー。ログアウトで未ログインに戻る", async ({ page }) => {
    await seed(page, { users: { "p@x.jp": { uid: "uid2", password: "password1" } }, data: member() });
    await page.goto("html/login.html");
    await page.fill("#email", "p@x.jp");
    await page.fill("#password", "machigai99");
    await page.locator("#login-form button[type=submit]").click();
    await expect(page.locator("#login-error")).toContainText("メールアドレスまたはパスワードが違います");

    await page.fill("#password", "password1");
    await page.locator("#login-form button[type=submit]").click();
    await expect(page).not.toHaveURL(/login\.html/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mockAuth")).current)).toBe("uid2");

    await page.goto("html/mypage.html");
    await expect(page.locator("#current-name")).toHaveText("巡礼者");
    await page.locator(".logout-btn").click();
    await page.locator("#logout-modal button", { hasText: "ログアウト" }).last().click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mockAuth")).current)).toBeNull();

    // ログインせずにマイページを開いても、前の人の名前・アイコンは出ない
    await page.goto("html/mypage.html");
    await expect(page.locator("#current-user-id")).toHaveText("ゲスト（ログインしていません）");
    await expect(page.locator("#current-name")).toHaveText("ゲスト");
    await expect(page.locator("#current-icon")).toHaveText("👤");
    expect(await page.evaluate(() => localStorage.getItem("seitiProfile"))).toBeNull();
});

test("ログインしていない時のマイページには、端末に残った前の人の名前・アイコンを出さない", async ({ page }) => {
    await seed(page, { local: { seitiProfile: JSON.stringify({ name: "前の人", icon: "🐱" }) } });
    await page.goto("html/mypage.html");
    await expect(page.locator("#current-user-id")).toHaveText("ゲスト（ログインしていません）");
    await expect(page.locator("#current-name")).toHaveText("ゲスト");
    await expect(page.locator("#current-icon")).toHaveText("👤");
});

test("TC-067 パスワード再発行：メールアドレスに再設定のメールを送る", async ({ page }) => {
    await seed(page, { users: { "p@x.jp": { uid: "uid2", password: "password1" } } });
    await page.goto("html/login.html");
    await page.locator(".forgot-link").click();
    await expect(page).toHaveURL(/forgot_password\.html/);
    await page.fill("#email", "p@x.jp");
    await page.click("#reissue-btn");
    await expect(page.locator("#completion-modal")).toBeVisible();
    const sent = await page.evaluate(() => JSON.parse(localStorage.getItem("mockResets") || "[]"));
    expect(sent.map((s) => s.email)).toEqual(["p@x.jp"]);
});

test("TC-069 お問い合わせ：内容を入れて送ると、完了の表示が出る", async ({ page }) => {
    await seed(page, { ...MEMBER, data: member() });
    await page.goto("html/information.html");
    await expect(page.locator("#contact-form")).toBeVisible();
    await page.fill("#contactText", "テストのお問い合わせです。");
    await page.click("#contact-btn");
    await expect(page.locator("#completePage")).toBeVisible();
    const store = await readStore(page);
    expect(JSON.stringify(store)).toContain("テストのお問い合わせです。");
});
