// 巡礼を続けやすくする：詳細パネルをなぞって閉じる・広げる、近くの聖地の一覧、
// スタンプの後の「次の聖地へ」、スタンプ帳から「まだの聖地」をルートに入れる
import { test, expect, seed, withSpots, PROFILE, spotNamed, SPOTS } from "../helpers.js";

const [station, bridge] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
const EUPHO = station.title_name;
const euphoSpots = SPOTS.filter((spot) => spot.title_name === EUPHO);

// 指でなぞる（touchstart → touchmove → touchend）
async function swipe(page, selector, dy) {
    await page.evaluate(([sel, distance]) => {
        const element = document.querySelector(sel);
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + 60;
        const touch = (clientY) => new Touch({ identifier: 1, target: element, clientX: x, clientY });
        element.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(y)], bubbles: true, cancelable: true }));
        for (let i = 1; i <= 6; i++) {
            element.dispatchEvent(new TouchEvent("touchmove", { touches: [touch(y + (distance * i) / 6)], bubbles: true, cancelable: true }));
        }
        element.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(y + distance)], bubbles: true, cancelable: true }));
    }, [selector, dy]);
}

test.describe("スマホの聖地の詳細パネル", () => {
    test.use({ hasTouch: true });

    test("上になぞると全画面に広がり、下になぞると元の高さに戻る・閉じる。少しだけなら閉じない", async ({ page }) => {
        await seed(page);
        await page.goto("html/map.html?spot=" + bridge.id);
        const popup = page.locator(".mapboxgl-popup");
        const content = ".mapboxgl-popup-content";
        await expect(page.locator(".popup-card .popup-meta")).toBeVisible();
        await expect(page.locator(".sheet-handle")).toHaveCount(1);
        const normal = (await page.locator(content).boundingBox()).height;

        await swipe(page, content, -120);
        await expect(popup).toHaveClass(/is-sheet-expanded/);
        await expect.poll(async () => (await page.locator(content).boundingBox()).height).toBeGreaterThan(normal + 100);

        await swipe(page, content, 150);
        await expect(popup).not.toHaveClass(/is-sheet-expanded/);
        await expect(popup).toBeVisible();

        await swipe(page, content, 30);
        await expect(popup).toBeVisible();

        await swipe(page, content, 150);
        await expect(popup).toHaveCount(0);
        await expect(page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`)).not.toHaveClass(/is-selected/);
    });
});

test("「一覧」で、地図の真ん中から近い順に聖地を並べ、押すとその聖地の詳細を開く", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html");
    await expect(page.locator(".mapboxgl-marker[data-spot-id]").first()).toBeAttached();
    await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat] }), [bridge.coord.longitude, bridge.coord.latitude]);

    await page.click("#spot-list-btn");
    const sheet = page.locator("#spot-list-modal");
    await expect(sheet).toBeVisible();
    await expect(page.locator("#spot-list-note")).toContainText("地図の真ん中から近い順（近い 50 か所）");
    const items = page.locator(".spot-list-item");
    await expect(items).toHaveCount(50);
    await expect(items.first().locator(".spot-list-name")).toHaveText(bridge.spot_name);
    await expect(items.first().locator(".spot-list-title")).toHaveText(EUPHO);

    // 近い順（m と km をそろえて比べる）
    const meters = await page.locator(".spot-list-distance").allTextContents();
    const values = meters.map((text) => (text.endsWith("km") ? parseFloat(text) * 1000 : parseFloat(text)));
    expect(values).toEqual([...values].sort((a, b) => a - b));

    await items.nth(1).click();
    await expect(sheet).toBeHidden();
    const second = await page.locator(".popup-card .popup-spot").textContent();
    expect(second).not.toContain(bridge.spot_name);

    // Esc で閉じる
    await page.click("#spot-list-btn");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
});

test.describe("現在地が分かる時", () => {
    test.use({ geolocation: { latitude: station.coord.latitude, longitude: station.coord.longitude }, permissions: ["geolocation"] });

    test("「一覧」は現在地から近い順。絞り込み中はその作品だけ", async ({ page }) => {
        await seed(page);
        await page.goto("html/map.html");
        await expect(page.locator(".mapboxgl-user-location-dot").first()).toBeAttached();
        await page.evaluate((title) => { window.__map.jumpTo({ center: [139.7, 35.7] }); return title; }, EUPHO);

        await page.click("#spot-list-btn");
        await expect(page.locator("#spot-list-note")).toContainText("現在地から近い順");
        await expect(page.locator(".spot-list-item").first().locator(".spot-list-name")).toHaveText(station.spot_name);
        await page.keyboard.press("Escape");

        // 作品で絞り込む
        await page.click("#filter-btn");
        await page.locator("#anime-list .anime-item", { hasText: EUPHO }).locator("input").first().check();
        await page.click("#filter-ok");
        await page.click("#spot-list-btn");
        await expect(page.locator("#spot-list-note")).toContainText("絞り込み中の作品だけ");
        await expect(page.locator(".spot-list-item")).toHaveCount(euphoSpots.length);
    });
});

test.describe("スタンプを押した後の「次の聖地へ」", () => {
    test.use({ motion: "no-preference" });

    const route = (ids) => withSpots({
        user: { uid2: PROFILE("巡礼者", "p@x.jp") },
        course: { c1: { title_name: EUPHO, course_name: "2か所", description: "", spot_ids: ids, updated_at: { __ts: 1 } } }
    });

    test("ルート案内に入っていれば、ルートの次の聖地を出し、詳細へ移れる。自動では閉じない", async ({ page }) => {
        await seed(page, { user: "uid2", data: route([station.id, bridge.id]) });
        await page.goto("html/map.html?course=c1");
        await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
        await page.evaluate((id) => window.goToSpot(id), station.id);
        await expect(page.locator(".popup-card .popup-meta")).toBeVisible();
        await page.evaluate((id) => window.setStampTestLocation(id, 10), station.id);
        await page.evaluate((id) => window.collectStamp(id), station.id);

        const goto = page.locator(".stamp-celebration-goto");
        await expect(goto).toContainText("ルートの次の聖地");
        await expect(goto.locator(".stamp-celebration-goto-name")).toContainText(bridge.spot_name);
        await expect(goto.locator(".stamp-celebration-goto-walk")).toHaveAttribute("href",
            `https://www.google.com/maps/dir/?api=1&destination=${bridge.coord.latitude},${bridge.coord.longitude}&travelmode=walking`);

        // ふだんは4秒で閉じるが、次の聖地を出した時は残す
        await page.waitForTimeout(4500);
        await expect(goto).toBeVisible();

        await goto.locator(".stamp-celebration-goto-detail").click();
        await expect(page.locator(".stamp-celebration")).toHaveCount(0);
        await expect(page.locator(".popup-card .popup-spot")).toContainText(bridge.spot_name);
    });

    test("ルートに無ければ、同じ作品の近くのまだの聖地を出す", async ({ page }) => {
        await seed(page, { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
        await page.goto("html/map.html?spot=" + bridge.id);
        await expect(page.locator(".popup-card .popup-meta")).toBeVisible();
        await page.evaluate((id) => window.setStampTestLocation(id, 10), bridge.id);
        await page.evaluate((id) => window.collectStamp(id), bridge.id);

        const goto = page.locator(".stamp-celebration-goto");
        await expect(goto).toContainText("近くのまだの聖地");
        const name = await goto.locator(".stamp-celebration-goto-name").textContent();
        expect(euphoSpots.some((spot) => spot.id !== bridge.id && name.includes(spot.spot_name))).toBe(true);
    });
});

test("スタンプ帳から、まだの聖地を地図のルート案内に入れられる（多い時は話の順に10か所）", async ({ page }) => {
    const mine = (spot) => ({ user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + spot.id }, time_stamp: { __ts: Date.UTC(2026, 10, 1) } });
    await seed(page, { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") }, stamp: { t1: mine(bridge) } }) });
    await page.goto("html/stamp.html");

    const section = page.locator(".stamp-section", { has: page.locator("h2", { hasText: EUPHO }) });
    const todo = section.locator(".stamp-todo");
    await expect(todo).toContainText(`まだの聖地 ${euphoSpots.length - 1} か所（ルートには話の順に 10 か所）`);
    // 獲得済みの作品にだけ出す（獲得済みの聖地はルートに入れない）
    const href = await todo.locator("a").getAttribute("href");
    expect(href).not.toContain(bridge.id);

    // まだの聖地を押すと「ルートに入れる」が出る（獲得済みには出ない）
    await section.locator(".stamp-item.is-locked").first().click();
    await expect(page.locator("#modal-route-link")).toBeVisible();
    await page.evaluate(() => window.closeStampModal ? window.closeStampModal() : document.getElementById("stamp-modal").style.display = "none");
    await section.locator(".stamp-item:not(.is-locked)").first().click();
    await expect(page.locator("#modal-route-link")).toBeHidden();
    await page.evaluate(() => document.getElementById("stamp-modal").style.display = "none");

    await todo.locator("a").click();
    await expect(page).toHaveURL(/map\.html\?route=/);
    await expect(page.locator("#routeList .routeItem")).toHaveCount(10);
    await expect(page.locator("#toast")).toContainText(`「「${EUPHO}」のまだの聖地」（10か所）をルート案内に入れました`);
});
