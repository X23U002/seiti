// 動き：ピンが落ちてくる・押したピンが跳ねる・ルートの線が伸びる・スタンプを押した瞬間の演出・
// 近づいた時のスタンプのボタン・シートの出入り・数のカウントアップ・読み込み中の表示・お気に入りのハート
// （ほかのテストは「動きを減らす」設定で動かしているので、ここだけ動きを付けて確かめる）
import { test, expect, seed, withSpots, PROFILE, spotNamed, SPOTS } from "../helpers.js";

test.use({ motion: "no-preference" });

const pins = (page) => page.locator(".mapboxgl-marker[data-spot-id]");

test("初めて出すピンは上から落ちてくる。描き直しても繰り返さない。押したピンは跳ねる", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);

    // 落ちてくる動き（少しずつずらす）
    const animations = await pins(page).evaluateAll((list) => list.slice(0, 3).map((pin) => getComputedStyle(pin).animationName));
    expect(animations).toEqual(["pin-drop", "pin-drop", "pin-drop"]);
    const delays = await pins(page).evaluateAll((list) => list.slice(0, 3).map((pin) => pin.style.getPropertyValue("--pin-delay")));
    expect(delays).toEqual(["0ms", "18ms", "36ms"]);

    // 落ち終わったら印を外し、描き直しても落とさない
    await expect(page.locator(".mapboxgl-marker.pin-drop")).toHaveCount(0, { timeout: 10_000 });
    await page.evaluate(() => window.__map.zoomTo(window.__map.getZoom() + 0.5, { duration: 0 }));
    await page.waitForTimeout(300);
    await expect(page.locator(".mapboxgl-marker.pin-drop")).toHaveCount(0);

    // 押したピン（詳細を開いたピン）は跳ねる
    await page.goto("html/map.html?spot=" + bridge.id);
    const selected = page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"]`);
    await expect(selected).toHaveClass(/is-selected/);
    expect(await selected.evaluate((pin) => getComputedStyle(pin).animationName)).toBe("pin-hop");
});

test("ルートの線は、1番目の聖地から順に伸びていく", async ({ page }) => {
    const order = ["京阪宇治駅", "宇治橋", "大吉山展望台"].map(spotNamed);
    const line = order.map((spot) => [spot.coord.longitude, spot.coord.latitude]);
    await page.route(/\/directions\/v5\/mapbox\/walking\//, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
            code: "Ok",
            routes: [{
                distance: 1700,
                duration: 1230,
                legs: [0, 1].map((i) => ({ distance: 800, duration: 600, steps: [{ geometry: { type: "LineString", coordinates: [line[i], line[i + 1]] } }] })),
                geometry: { type: "LineString", coordinates: line }
            }]
        })
    }));
    await seed(page, {
        data: withSpots({
            course: { c1: { title_name: order[0].title_name, course_name: "伸びる線", description: "", spot_ids: order.map((s) => s.id), updated_at: { __ts: 1 } } }
        })
    });
    await page.goto("html/map.html?course=c1");
    await expect(page.locator("#routeList .routeItem")).toHaveCount(3);

    // 線の長さ（座標の数と、最後の点）を、伸びている途中から何度か記録する
    await page.click("#generate-mapbox-route");
    const samples = await page.evaluate(async () => {
        const source = window.__map.getSource("selected-spots-route");
        const result = [];
        const start = performance.now();
        while (performance.now() - start < 2500) {
            const features = source._data.features;
            result.push(features.length);
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return result;
    });
    // 最初は1区間目だけ（途中まで）で、最後は2区間とも出ている
    expect(samples).toContain(1);
    expect(samples[samples.length - 1]).toBe(2);
    expect(samples.indexOf(1)).toBeLessThan(samples.indexOf(2));
});

test("スタンプを押した瞬間に、インクのにじみ・光・振動を出す", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await page.addInitScript(() => {
        window.__vibrations = [];
        navigator.vibrate = (pattern) => { window.__vibrations.push(pattern); return true; };
    });
    await seed(page, { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(page.locator(".popup-meta")).toBeVisible();
    await page.evaluate((id) => window.setStampTestLocation(id, 10), bridge.id);
    await page.evaluate((id) => window.collectStamp(id), bridge.id);

    const celebration = page.locator(".stamp-celebration");
    await expect(celebration).toBeVisible();
    await expect(celebration.locator(".stamp-ink")).toHaveCount(1);
    await expect(celebration.locator(".stamp-sparks > span")).toHaveCount(10);
    expect(await celebration.locator(".stamp-ink").evaluate((ink) => getComputedStyle(ink).animationName)).toBe("stamp-ink");
    await expect.poll(() => page.evaluate(() => window.__vibrations)).toEqual([45]);
});

test("聖地に近づくほどスタンプのボタンの色が変わり、取れる距離ではボタンが脈打つ", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await seed(page, { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
    await page.goto("html/map.html?spot=" + bridge.id);
    const button = page.locator(".popup-card .stamp-button");
    await expect(button).toBeVisible();

    const stageAt = async (meters) => {
        await page.evaluate(([id, distance]) => window.setStampTestLocation(id, distance), [bridge.id, meters]);
        return button.getAttribute("data-stamp-stage");
    };
    await expect.poll(() => stageAt(3000)).toBe("");
    await expect.poll(() => stageAt(600)).toBe("closer");
    await expect.poll(() => stageAt(150)).toBe("near");
    await expect.poll(() => stageAt(10)).toBe("ready");
    expect(await button.evaluate((el) => getComputedStyle(el).animationName)).toBe("stamp-ready");
});

test("絞り込みのシートは下からせり上がり、閉じる時は引っ込んでから消える", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);
    await page.click("#filter-btn");
    const sheet = page.locator("#filter-modal");
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe("sheet-rise");

    await page.evaluate(() => window.closeFilter());
    await expect(sheet).toHaveClass(/is-closing/);
    await expect(sheet).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(sheet).not.toHaveClass(/is-closing/);
});

test("数はカウントアップして出す", async ({ page }) => {
    await seed(page);
    await page.goto("html/stamp.html");
    const values = await page.evaluate(async () => {
        const element = document.createElement("span");
        element.textContent = "0";
        document.body.appendChild(element);
        window.countUp(element, 20);
        const seen = [];
        const start = performance.now();
        while (performance.now() - start < 1500) {
            seen.push(element.textContent);
            await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return seen;
    });
    expect(values[values.length - 1]).toBe("20");
    // 途中の数も出ている
    expect(values.some((value) => Number(value) > 0 && Number(value) < 20)).toBe(true);
});

test("読み込み中は、カードの形の影を光らせる。読み込めたら消える", async ({ page }) => {
    // Firestore が遅い（8秒待ってから Web API で読む）時の再現
    await seed(page, { local: { mockFsHang: "1" } });
    await page.goto("html/works.html");
    const notice = page.locator("#works-notice");
    await expect(notice).toHaveClass(/is-loading/);
    await expect(notice.locator(".skeleton-line")).toHaveCount(4);
    expect(await notice.locator(".skeleton-line").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("skeleton-shine");
    await expect(page.locator("#work-list .work-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(notice).toBeHidden();
});

test("お気に入りにすると、ハートがはじけて小さなハートが散る", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await seed(page, { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
    await page.goto("html/map.html?spot=" + bridge.id);
    const heart = page.locator(".popup-card .popup-fav");
    await expect(heart).toBeVisible();
    await heart.click();
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    await expect(heart.locator(".heart-particle")).toHaveCount(6);
    await expect(heart.locator(".heart-particle")).toHaveCount(0);

    // 外す時は散らさない
    await heart.click();
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    await expect(heart.locator(".heart-particle")).toHaveCount(0);
});
