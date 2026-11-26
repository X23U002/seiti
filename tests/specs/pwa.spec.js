// アプリとして使う：ホーム画面に追加（manifest）・電波が無くても開ける（service worker）
import { test, expect, seed, withSpots, spotNamed, SPOTS } from "../helpers.js";

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
    // 地図の絵は出せないので、うすい地面だけの地図にして知らせる（ピンは使える）
    const note = page.locator("#offline-map-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("圏外のため、残しておいた地図（国土地理院）を出しています");
    expect(await page.evaluate(() => window.__map.getStyle().layers[0].id)).toBe("offline-background");

    // 電波が戻ったら、地図の絵を読み直して知らせを消す
    await context.setOffline(false);
    await expect(note).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__map.getStyle().layers[0].id)).not.toBe("offline-background");
    await expect(pins(page)).toHaveCount(SPOTS.length);
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

test("どのページにもタブのアイコンがあり、読める（無いとブラウザがサイトの一番上の favicon.ico を探して 404 になる）", async ({ request, baseURL }) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const htmlDir = path.join(process.cwd(), "..", "map画面", "html");
    const pages = fs.readdirSync(htmlDir).filter((name) => name.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(10);
    for (const name of pages) {
        const html = fs.readFileSync(path.join(htmlDir, name), "utf8");
        const href = html.match(/<link rel="icon"[^>]*href="([^"]+)"/)?.[1];
        expect(href, name + " にタブのアイコンの指定がある").toBeTruthy();
        const response = await request.get(new URL(href, new URL("html/" + name, baseURL)).href);
        expect(response.ok(), name + " のアイコンが読める").toBe(true);
    }
    // トップページ（リポジトリの一番上の index.html）
    const top = fs.readFileSync(path.join(process.cwd(), "..", "index.html"), "utf8");
    const topIcon = top.match(/<link rel="icon"[^>]*href="([^"]+)"/)?.[1];
    expect(fs.existsSync(path.join(process.cwd(), "..", topIcon))).toBe(true);
});

// ---------- 圏外用の地図（国土地理院の地理院タイル。offline-map.js） ----------
// 1×1 の PNG（地理院タイルの代わり）
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const tileCount = (page) => page.evaluate(async () => (await (await caches.open("seiti-offline-map-v1")).keys()).length);

// 地理院のサーバーの代わり。state.offline の間は答えない（圏外）
async function serveGsi(page) {
    const state = { offline: false, requests: 0 };
    await page.context().route(/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\//, (route) => {
        if (state.offline) return route.abort("internetdisconnected");
        state.requests += 1;
        return route.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: PNG });
    });
    return state;
}

test("電波がある時に寄せて見た場所の地図を、圏外用に残す（引いた広い範囲は残さない）", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await serveGsi(page);
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);
    // 引いている時は残さない
    await page.evaluate(() => window.__map.jumpTo({ zoom: 10 }));
    await page.waitForTimeout(2500);
    expect(await tileCount(page)).toBe(0);
    // 寄せると残す
    await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat], zoom: 16 }), [bridge.coord.longitude, bridge.coord.latitude]);
    await expect.poll(() => tileCount(page), { timeout: 10000 }).toBeGreaterThan(0);
    expect(await tileCount(page)).toBeLessThanOrEqual(40);
});

test("ルートの周りの地図を保存しておくと、圏外では残した地理院タイルの地図を出す", async ({ page, context }) => {
    const [station, bridge] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
    const gsi = await serveGsi(page);
    await seed(page, { data: withSpots({ course: { c1: { title_name: station.title_name, course_name: "2か所", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } } }) });
    await page.goto("html/map.html?course=c1");
    await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator("#routeList .routeItem")).toHaveCount(2);

    await page.click("#save-route-map");
    await expect(page.locator("#toast")).toContainText("ルートの周りの地図を保存しました");
    const saved = await tileCount(page);
    expect(saved).toBeGreaterThan(10);

    // 圏外で開き直す：残した地理院タイルで地図を出し、出典（国土地理院）も出す
    await context.setOffline(true);
    gsi.offline = true;
    await page.reload();
    await expect(page.locator("#offline-map-note")).toContainText("残しておいた地図（国土地理院）");
    await page.evaluate(() => {
        window.__loadedTiles = 0;
        window.__map.on("data", (event) => {
            if (event.sourceId === "offline-gsi" && event.tile && event.tile.state === "loaded") window.__loadedTiles += 1;
        });
    });
    await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat], zoom: 16 }), [bridge.coord.longitude, bridge.coord.latitude]);
    await expect.poll(() => page.evaluate(() => window.__loadedTiles), { timeout: 15000 }).toBeGreaterThan(0);
    await expect(page.locator(".mapboxgl-ctrl-attrib")).toContainText("国土地理院");
    await context.setOffline(false);
});
