// アプリとして使う：ホーム画面に追加（manifest）・電波が無くても開ける（service worker）
import { test, expect, seed, SPOTS } from "../helpers.js";

test.use({ serviceWorkers: "allow" });

const pins = (page) => page.locator(".mapboxgl-marker[data-spot-id]");

test("ホーム画面に追加できる情報（名前・アイコン・開くページ）がある", async ({ page, request }) => {
    await seed(page);
    await page.goto("html/map.html");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await request.get(new URL(href, page.url()).href)).json();
    expect(manifest).toMatchObject({ name: "聖地巡礼NAVI", display: "standalone", start_url: "html/map.html" });
    for (const icon of manifest.icons) {
        const response = await request.get(new URL(icon.src, new URL(href, page.url())).href);
        expect(response.ok()).toBe(true);
    }
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b3c5d");
});

test("一度開いたら、圏外でも地図の画面と前に見た聖地が出る", async ({ page, context }) => {
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);
    // オフライン用の準備ができて、画面の部品を残し終えるまで待つ
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(pins(page)).toHaveCount(SPOTS.length);
    await page.waitForTimeout(1000);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#map")).toBeVisible();
    await expect(pins(page)).toHaveCount(SPOTS.length, { timeout: 30_000 });
    await context.setOffline(false);
});

test("聖地の写真を同じ名前で差し替えたら、次に開いた時は新しい写真が出る", async ({ page, context }) => {
    // GitHub Pages と同じく、ブラウザに10分残してよいと返す
    let version = "old";
    await context.route(/\/images\/spots\/test\/replace\.jpg/, (route) => route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        headers: { "Cache-Control": "max-age=600" },
        body: version
    }));
    await seed(page);
    await page.goto("html/map.html");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    const load = () => page.evaluate(() => fetch("../images/spots/test/replace.jpg").then((r) => r.text()));
    expect(await load()).toBe("old");

    version = "new";
    expect(await load()).toBe("new");

    // 圏外の時は、残した写真を出す
    await context.setOffline(true);
    expect(await load()).toBe("new");
    await context.setOffline(false);
});
