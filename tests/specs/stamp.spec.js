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

// ---------- スタンプの絵は、その聖地に登録した画像 ----------

const IMAGE = "images/spots/anime/s0701.png";

test("スタンプ帳：取ったスタンプには聖地の画像、画像の無い聖地は ⛩️、まだのものは ?", async ({ page }) => {
    const [station, noImage, locked] = ["京阪宇治駅", "宇治橋", "大吉山展望台"].map(spotNamed);
    const data = withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } });
    data.spot[station.id].image_url = IMAGE;
    data.spot[noImage.id].image_url = "no_image";
    data.spot[locked.id].image_url = IMAGE;
    data.stamp = {
        t1: { user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + station.id }, time_stamp: { __ts: 1 } },
        t2: { user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + noImage.id }, time_stamp: { __ts: 2 } }
    };
    await seed(page, { user: "uid2", data });
    await page.goto("html/stamp.html");

    const item = (spot) => page.locator(".stamp-item", { has: page.locator(".stamp-label", { hasText: spot.spot_name }) }).first();
    const image = item(station).locator(".stamp-circle img.stamp-image");
    await expect(image).toHaveAttribute("src", "../" + IMAGE);
    await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(item(noImage).locator(".stamp-circle")).toHaveText("⛩️");
    await expect(item(locked).locator(".stamp-circle")).toHaveText("?");
    await expect(item(locked).locator("img")).toHaveCount(0);

    // 詳細も同じ画像
    await item(station).click();
    await expect(page.locator("#modal-circle img.stamp-image")).toHaveAttribute("src", "../" + IMAGE);
});

test("スタンプを取った時のお祝いにも、聖地の画像を出す", async ({ page }) => {
    const data = withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } });
    data.spot[bridge.id].image_url = IMAGE;
    await seed(page, { user: "uid2", data });
    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(page.locator(".popup-meta")).toBeVisible();
    await page.evaluate((id) => window.setStampTestLocation(id, 10), bridge.id);
    await page.evaluate((id) => window.collectStamp(id), bridge.id);
    await expect(page.locator(".stamp-celebration-stamp img.stamp-image")).toHaveAttribute("src", "../" + IMAGE);
});
