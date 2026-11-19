// 聖地登録の申請 → 管理ページで確認して地図に追加する
import { test, expect, seed, withSpots, readStore, switchUser, PROFILE } from "../helpers.js";

const people = {
    admin: { uid1: { name: "管理者" } },
    user: { uid1: PROFILE("管理者", "a@x.jp"), uid2: PROFILE("巡礼者", "p@x.jp") }
};

test("入力が足りないと、足りない項目を知らせる", async ({ page }) => {
    await seed(page, { user: "uid2", data: withSpots(people) });
    await page.goto("html/register.html");
    await page.click("#register-btn");
    for (const id of ["#animeName", "#spotName", "#spotText", "#address"]) {
        await expect(page.locator(id).locator("xpath=ancestor::*[contains(@class,'form-group')][1]")).toHaveClass(/has-error/);
    }
});

test("ピンと期・話を入れて申請すると、管理ページの確認画面にそのまま入る", async ({ page }) => {
    await seed(page, { user: "uid2", data: withSpots(people) });
    await page.goto("html/register.html");
    await page.fill("#animeName", "響け！ユーフォニアム");
    await page.fill("#spotName", "テストの橋");
    await page.fill("#spotText", "久美子が走る場面。\n2行目");
    await page.fill("#season", "1");
    await page.fill("#episode", "12");

    // 地図の真ん中を押してピンを置く
    const map = page.locator("#pin-map");
    await map.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("#pin-map canvas"));
    await map.click();
    await expect(page.locator("#coord-text")).toContainText("緯度");

    await page.click("#register-btn");
    await expect(page.locator("#completePage")).toBeVisible();

    const requests = Object.values((await readStore(page)).request_spot || {});
    expect(requests).toHaveLength(1);
    expect(requests[0].request_title).toBe("テストの橋");
    expect(requests[0].request_info).toContain("期：1");
    expect(requests[0].request_info).toContain("話：12");
    expect(requests[0].coord).toHaveProperty("latitude");

    // 管理者で確認する
    await switchUser(page, "uid1");
    await page.goto("html/admin.html");
    const item = page.locator("#request-list .admin-item").first();
    await expect(item).toContainText("テストの橋");
    await expect(item).toContainText("1期 12話");
    await item.locator("button", { hasText: "確認して" }).click();
    await expect(page.locator("#ap-title-name")).toHaveValue("響け！ユーフォニアム");
    await expect(page.locator("#ap-season")).toHaveValue("1");
    await expect(page.locator("#ap-episode")).toHaveValue("12");
    await expect(page.locator("#ap-spot-info")).toHaveValue("久美子が走る場面。\n2行目");
    await expect(page.locator("#ap-coord-text")).toContainText("緯度");
});
