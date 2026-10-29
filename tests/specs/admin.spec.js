// 管理ページ：聖地の削除・管理者でない人
import { test, expect, seed, withSpots, readStore, PROFILE, spotNamed, SPOTS } from "../helpers.js";

test("聖地を削除すると、その聖地を含むおすすめルートも直す", async ({ page }) => {
    const [a, b, c] = ["京阪宇治駅", "宇治橋", "大吉山展望台"].map(spotNamed);
    await seed(page, {
        user: "uid1",
        data: withSpots({
            admin: { uid1: { name: "管理者" } },
            user: { uid1: PROFILE("管理者", "a@x.jp") },
            course: {
                c1: { title_name: a.title_name, course_name: "3か所ルート", description: "", spot_ids: [a.id, b.id, c.id], updated_at: { __ts: 1 } },
                c2: { title_name: a.title_name, course_name: "2か所ルート", description: "", spot_ids: [b.id, c.id], updated_at: { __ts: 1 } }
            }
        })
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("html/admin.html");
    await page.click("#tab-spots");

    // 新しく登録する時は削除ボタンを出さない
    await page.click("#spot-new");
    await expect(page.locator("#ap-delete")).toBeHidden();
    await page.evaluate(() => window.closeApprove());

    await page.fill("#spot-search", "宇治橋");
    await page.locator("#spot-list .spot-item button", { hasText: "編集" }).first().click();
    await expect(page.locator("#ap-delete")).toBeVisible();
    await page.click("#ap-delete");
    await expect(page.locator("#toast")).toContainText("削除しました");

    const store = await readStore(page);
    expect(store.spot[b.id]).toBeUndefined();
    expect(Object.keys(store.spot)).toHaveLength(SPOTS.length - 1);
    expect(store.course.c1.spot_ids).toEqual([a.id, c.id]);
    expect(store.course.c2).toBeUndefined();
});

test("管理者でない人には管理ページの中身を出さない", async ({ page }) => {
    await seed(page, { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
    await page.goto("html/admin.html");
    await expect(page.locator("#admin-main")).toBeHidden();
});

test("説明文から読み取れた期・話を、全作品まとめて保存できる（読み取れない聖地・入力済みの聖地はそのまま）", async ({ page }) => {
    const data = withSpots({
        admin: { uid1: { name: "管理者" } },
        user: { uid1: PROFILE("管理者", "a@x.jp") }
    });
    const ids = Object.keys(data.spot);
    const [readable, unreadable, alreadySet] = ids;
    data.spot[readable].spot_info = "1期3話。テストの場面。";
    data.spot[unreadable].spot_info = "話数の書いていない説明。";
    data.spot[alreadySet].spot_info = "2話。もう入れてある。";
    Object.assign(data.spot[alreadySet], { season: 9, episode: 9 });

    await seed(page, { user: "uid1", data });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("html/admin.html");
    await page.click("#tab-episodes");
    await expect(page.locator("#episode-bulk-note")).toContainText("説明文から読み取れます");
    await page.click("#episode-bulk");
    await expect(page.locator("#toast")).toContainText("期・話を保存しました");

    const store = await readStore(page);
    expect([store.spot[readable].season, store.spot[readable].episode]).toEqual([1, 3]);
    expect("season" in store.spot[unreadable]).toBe(false);
    expect([store.spot[alreadySet].season, store.spot[alreadySet].episode]).toEqual([9, 9]);
    await expect(page.locator("#episode-bulk")).toBeDisabled();
});
