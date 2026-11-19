// スタンプ：聖地の近くでだけ取れ、取った場所も保存する
import { test, expect, seed, withSpots, readStore, PROFILE, spotNamed } from "../helpers.js";

const bridge = spotNamed("宇治橋");

async function openSpot(page) {
    await seed(page, {
        user: "uid2",
        data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }),
        local: { "osikatumap-stamp-history-v2": JSON.stringify({ s1: Date.now() }) }
    });
    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(page.locator(".popup-meta")).toBeVisible();
    // DB からスタンプを読み終えるまで待つ
    await page.waitForFunction(() => !localStorage.getItem("osikatumap-stamp-history-v2"));
}

test("聖地の近くで取ると、取った場所といっしょに保存する", async ({ page }) => {
    await openSpot(page);
    await page.evaluate((id) => window.setStampTestLocation(id, 10), bridge.id);
    await page.evaluate((id) => window.collectStamp(id), bridge.id);
    await expect.poll(async () => Object.keys((await readStore(page)).stamp || {}).length).toBe(1);

    const stamp = Object.values((await readStore(page)).stamp)[0];
    expect(stamp.user_id.__ref).toBe("user/uid2");
    expect(stamp.spot_id.__ref).toBe("spot/" + bridge.id);
    expect(stamp.position).toHaveProperty("latitude");
    expect(await page.evaluate(() => window.__lastStampDistance)).toBeLessThan(50);
});

test("聖地から離れていると取れない", async ({ page }) => {
    await openSpot(page);
    await page.evaluate((id) => window.setStampTestLocation(id, 500), bridge.id);
    await page.evaluate((id) => window.collectStamp(id), bridge.id);
    await page.waitForTimeout(500);
    expect((await readStore(page)).stamp).toBeUndefined();
});
