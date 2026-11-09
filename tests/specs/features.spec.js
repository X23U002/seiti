// 機能の追加：訪れる前の情報・近づいた時のお知らせ・バッジ・共有画像・よく使われている聖地の集計
import { test, expect, seed, withSpots, readStore, PROFILE, spotNamed, SPOTS } from "../helpers.js";

const bridge = spotNamed("宇治橋");
const admin = (extra) => withSpots(Object.assign({
    admin: { uid1: { name: "管理者" } },
    user: { uid1: PROFILE("管理者", "a@x.jp") }
}, extra || {}));

test("管理ページで訪れる人への情報を入れると、聖地の詳細の「訪れる前に」に出る（マナーはいつも出す）", async ({ page }) => {
    await seed(page, { user: "uid1", data: admin() });

    // 何も入れていない聖地にも、マナーは出す
    await page.goto("html/map.html?spot=" + bridge.id);
    const visit = page.locator(".popup-card .popup-visit");
    await expect(visit.locator(".popup-manner")).toContainText("私有地への立ち入り");
    await expect(visit.locator(".popup-visit-item")).toHaveCount(0);

    await page.goto("html/admin.html");
    await page.click("#tab-spots");
    await page.fill("#spot-search", "宇治橋");
    await page.locator("#spot-list .spot-item button", { hasText: "編集" }).first().click();
    await page.fill("#ap-open_hours", "24時間");
    await page.fill("#ap-fee", "無料");
    await page.fill("#ap-caution", "車道が近いので、写真は歩道から");
    await page.click("#ap-submit");
    await expect(page.locator("#toast")).toContainText("保存しました");
    const saved = (await readStore(page)).spot[bridge.id];
    expect(saved).toMatchObject({ open_hours: "24時間", fee: "無料", closed_days: "", access: "", caution: "車道が近いので、写真は歩道から" });

    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(visit.locator(".popup-visit-item dt")).toHaveText(["入れる時間", "料金", "注意"]);
    await expect(visit.locator(".popup-visit-item.is-caution dd")).toHaveText("車道が近いので、写真は歩道から");

    // もう一度開くと、入れた値が入っている
    await page.goto("html/admin.html");
    await page.click("#tab-spots");
    await page.fill("#spot-search", "宇治橋");
    await page.locator("#spot-list .spot-item button", { hasText: "編集" }).first().click();
    await expect(page.locator("#ap-open_hours")).toHaveValue("24時間");
});

test.describe("ルート案内の聖地に近づいた時", () => {
    const station = spotNamed("京阪宇治駅");
    // 京阪宇治駅から南へ約1km
    const FAR = { latitude: station.coord.latitude - 0.009, longitude: station.coord.longitude };
    // 振動は、動きを減らす設定の人には出さないので、ここでは動きを付ける
    test.use({ geolocation: FAR, permissions: ["geolocation"], motion: "no-preference" });

    test("150m 以内に入ったら「もうすぐ」と知らせ、詳細も開ける。同じ聖地では1回だけ", async ({ page, context }) => {
        await page.addInitScript(() => {
            window.__vibrations = [];
            navigator.vibrate = (pattern) => { window.__vibrations.push(pattern); return true; };
        });
        await seed(page);
        await page.goto("html/map.html");
        await expect(page.locator(".mapboxgl-user-location-dot").first()).toBeAttached();
        // 2か所目は離れた聖地（大吉山展望台）にする
        await page.evaluate((ids) => ids.forEach((id) => window.addSpotToRouteById(id, { silent: true })), [station.id, spotNamed("大吉山展望台").id]);
        await expect(page.locator("#routeList .routeItem")).toHaveCount(2);

        // 京阪宇治駅の約100m 南へ
        await context.setGeolocation({ latitude: station.coord.latitude - 0.0009, longitude: station.coord.longitude });
        const toast = page.locator("#toast");
        await expect(toast).toContainText(`もうすぐ「${station.spot_name}」です（あと約100m）`);
        await expect.poll(() => page.evaluate(() => window.__vibrations.length)).toBe(1);
        await toast.locator(".toast-action", { hasText: "詳細を見る" }).click();
        await expect(page.locator(".popup-card")).toBeVisible();

        // 同じ聖地の近くで動いても、もう一度は知らせない
        await context.setGeolocation({ latitude: station.coord.latitude - 0.0008, longitude: station.coord.longitude });
        await page.waitForTimeout(800);
        expect(await page.evaluate(() => window.__vibrations.length)).toBe(1);
    });
});

test("マイページに、スタンプの記録から決めたバッジを出す（まだのものは、あといくつか）", async ({ page }) => {
    const [a, b, c] = ["京阪宇治駅", "宇治橋", "大吉山展望台"].map(spotNamed);
    // 日本時間 2026/11/01 の 10時・11時・12時
    const day = Date.UTC(2026, 10, 1, 1, 0, 0);
    const mine = (spot, ms) => ({ user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + spot.id }, time_stamp: { __ts: ms } });
    await seed(page, {
        user: "uid2",
        data: withSpots({
            user: { uid2: PROFILE("巡礼者", "p@x.jp") },
            stamp: { t1: mine(a, day), t2: mine(b, day + 3600e3), t3: mine(c, day + 7200e3) }
        })
    });
    await page.goto("html/mypage.html");
    const earned = page.locator(".badge-item.is-earned .badge-name");
    await expect(earned).toHaveText(["はじめの一歩", "巡礼の一日"]);
    await expect(page.locator("#badge-count")).toHaveText("2 / 11");
    await expect(page.locator(".badge-item", { hasText: "聖地ハンター" })).toContainText("あと 7");
    await expect(page.locator(".badge-item", { hasText: "健脚" })).toContainText("あと 2");
});

test("スタンプ帳の記録を、SNS に載せられる画像（1080×1350）にできる", async ({ page }) => {
    const [a, b] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
    const day = Date.UTC(2026, 10, 1, 1, 0, 0);
    const mine = (spot, ms) => ({ user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + spot.id }, time_stamp: { __ts: ms } });
    await seed(page, {
        user: "uid2",
        data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") }, stamp: { t1: mine(a, day), t2: mine(b, day + 60e3) } })
    });
    await page.goto("html/stamp.html");
    const button = page.locator("#share-record");
    await expect(button).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    expect(download.suggestedFilename()).toBe("seichi-junrei-record.png");
    const file = await download.path();
    const fs = await import("node:fs");
    const png = fs.readFileSync(file);
    // PNG の幅と高さ（IHDR）
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
    if (process.env.SHARE_CARD_OUT) fs.copyFileSync(file, process.env.SHARE_CARD_OUT);
});

test("スタンプが無い時は、共有のボタンを出さない", async ({ page }) => {
    await seed(page, { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
    await page.goto("html/stamp.html");
    await expect(page.locator("#got-count")).toHaveText("0");
    await expect(page.locator("#share-record")).toBeHidden();
});

test("管理ページの「集計」で、聖地・作品ごとのスタンプとお気に入りの数を見られる", async ({ page }) => {
    const [a, b] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
    const stamp = (user, spot) => ({ user_id: { __ref: "user/" + user }, spot_id: { __ref: "spot/" + spot.id }, time_stamp: { __ts: 1 } });
    const favorite = (user, spot) => ({ user_id: { __ref: "user/" + user }, spot_id: { __ref: "spot/" + spot.id }, time_stamp: { __ts: 1 } });
    await seed(page, {
        user: "uid1",
        data: admin({
            stamp: { t1: stamp("u2", a), t2: stamp("u2", a), t3: stamp("u3", a), t4: stamp("u3", b) },
            favorite: { u2_a: favorite("u2", b), u3_b: favorite("u3", b) }
        })
    });
    await page.goto("html/admin.html");
    await page.click("#tab-stats");
    await page.click("#stats-load");
    await expect(page.locator("#stats-summary .stats-box strong")).toHaveText(["4回", "2人", "2件"]);
    const ranking = page.locator("#stats-spots li");
    await expect(ranking.nth(0)).toContainText(a.spot_name);
    await expect(ranking.nth(0)).toContainText("スタンプ 3回（2人）・お気に入り 0");
    await expect(ranking.nth(1)).toContainText("スタンプ 1回（1人）・お気に入り 2");
    const eupho = page.locator("#stats-works tr", { hasText: a.title_name });
    await expect(eupho.locator("td")).toHaveText(["4", "2", "2", "2 / " + SPOTS.filter((s) => s.title_name === a.title_name).length]);
});
