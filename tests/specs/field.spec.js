// 現地で困らないように：圏外で押したスタンプを取りこぼさない・GPS の誤差が大きい時の案内・ルートを人に送る
import { test, expect, seed, withSpots, PROFILE, spotNamed, readStore } from "../helpers.js";

const [station, bridge] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
const EUPHO = station.title_name;
const member = () => withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } });
const stampsOf = async (page) => Object.values((await readStore(page)).stamp || {});

test("圏外で押したスタンプは端末に残し、電波が戻ったら自動で保存する", async ({ page, context }) => {
    await seed(page, { user: "uid2", data: member() });
    await page.goto("html/map.html?spot=" + bridge.id);
    const button = page.locator(".popup-card .stamp-button");
    await expect(button).toBeVisible();
    await page.evaluate((id) => window.setStampTestLocation(id, 10), bridge.id);

    await context.setOffline(true);
    await expect(page.locator(".popup-card .stamp-distance-message")).toContainText("圏外のため、電波が戻ったら保存します");
    await page.evaluate((id) => window.collectStamp(id), bridge.id);
    await expect(page.locator(".stamp-celebration-pending")).toContainText("電波が戻ったら自動で保存します");
    expect(await stampsOf(page)).toHaveLength(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("seitiPendingStamps")).length)).toBe(1);
    // 押したことにはなっている（✓・待ち時間）
    expect(await page.evaluate((id) => window.hasCollectedStamp(id), bridge.id)).toBe(true);

    await context.setOffline(false);
    await expect(page.locator("#toast")).toContainText("圏外で押したスタンプ（1件）を保存しました");
    const stamps = await stampsOf(page);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].spot_id.__ref).toBe("spot/" + bridge.id);
    expect(await page.evaluate(() => localStorage.getItem("seitiPendingStamps"))).toBeNull();
});

test("送る前にアプリを閉じても、次に開いた時に送る（ほかの人の分は送らない）", async ({ page }) => {
    const at = Date.now() - 60e3;
    const pending = [
        { uid: "uid2", spotId: bridge.id, latitude: bridge.coord.latitude, longitude: bridge.coord.longitude, at },
        { uid: "uid9", spotId: station.id, latitude: station.coord.latitude, longitude: station.coord.longitude, at }
    ];
    await seed(page, { user: "uid2", data: member(), local: { seitiPendingStamps: JSON.stringify(pending) } });
    await page.goto("html/map.html");
    await expect(page.locator("#toast")).toContainText("圏外で押したスタンプ（1件）を保存しました");
    const stamps = await stampsOf(page);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].spot_id.__ref).toBe("spot/" + bridge.id);
    // ほかの人の分は残す
    const rest = await page.evaluate(() => JSON.parse(localStorage.getItem("seitiPendingStamps")));
    expect(rest.map((item) => item.uid)).toEqual(["uid9"]);
});

test("GPS の誤差が大きい時は押せず、開けた所で待つよう案内する。誤差の分だけ近いかもしれない時も伝える", async ({ page }) => {
    await seed(page, { user: "uid2", data: member() });
    await page.goto("html/map.html?spot=" + bridge.id);
    const button = page.locator(".popup-card .stamp-button");
    const message = page.locator(".popup-card .stamp-distance-message");
    await expect(button).toBeVisible();

    await page.evaluate((id) => window.setStampTestLocation(id, 10, 150), bridge.id);
    await expect(button).toContainText("位置の誤差が大きいです");
    await expect(button).toBeDisabled();
    await expect(message).toContainText("GPS誤差 ±150m。建物の外や空の開けた所で");

    await page.evaluate((id) => window.setStampTestLocation(id, 90, 60), bridge.id);
    await expect(button).toBeDisabled();
    await expect(message).toContainText("GPS誤差 ±60m。少し待つと位置が正確になることがあります");

    // 誤差が小さく、はっきり遠い時は出さない
    await page.evaluate((id) => window.setStampTestLocation(id, 500, 10), bridge.id);
    await expect(message).not.toContainText("GPS誤差");

    await page.evaluate((id) => window.setStampTestLocation(id, 10, 10), bridge.id);
    await expect(button).toBeEnabled();
});

test("ルートを人に送れる。送られたリンクを開くと、同じ順番でルート案内に入る", async ({ page }) => {
    await page.addInitScript(() => {
        navigator.share = (data) => { window.__shared = data; return Promise.resolve(); };
    });
    // わざと遠い順（宇治橋 → 京阪宇治駅）にしても、送られた順番のまま
    await seed(page, {
        data: withSpots({ course: { c1: { title_name: EUPHO, course_name: "2か所", description: "", spot_ids: [bridge.id, station.id], updated_at: { __ts: 1 } } } })
    });
    await page.goto("html/map.html?course=c1");
    await expect(page.locator("#routeList .routeItem")).toHaveCount(2);

    await page.click("#share-route");
    const shared = await page.evaluate(() => window.__shared);
    expect(shared.title).toBe(`「${EUPHO}」の巡礼ルート`);
    expect(shared.text).toBe(`「${EUPHO}」の巡礼ルート（2か所：${bridge.spot_name}→${station.spot_name}）`);
    const url = new URL(shared.url);
    expect(url.pathname).toMatch(/\/html\/map\.html$/);
    expect(url.searchParams.get("route")).toBe(`${bridge.id},${station.id}`);

    // 送られた人が開く（まだ何も入っていない地図）
    const other = await page.context().newPage();
    await other.goto(shared.url);
    const items = other.locator("#routeList .routeItem");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText(bridge.spot_name);
    await expect(other.locator("#toast")).toContainText(`「「${EUPHO}」の巡礼ルート」（2か所）をルート案内に入れました`);
});

test("共有メニューが無いブラウザでは、ルートのリンクをコピーする", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => { delete Navigator.prototype.share; });
    await seed(page, {
        data: withSpots({ course: { c1: { title_name: EUPHO, course_name: "2か所", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } } })
    });
    await page.goto("html/map.html?course=c1");
    await expect(page.locator("#routeList .routeItem")).toHaveCount(2);
    await page.click("#share-route");
    await expect(page.locator("#toast")).toContainText("ルートのリンクをコピーしました");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("map.html?route=" + encodeURIComponent(`${station.id},${bridge.id}`));
});
