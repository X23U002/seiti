// 広告ブロックなどで Firestore の通信が止められた時、地図以外の画面も Web API から読む
import { test, expect, seed, withSpots, PROFILE } from "../helpers.js";

const mine = (extra) => Object.assign({ user_id: { __ref: "user/uid2" } }, extra);

test.describe(() => {
    test.slow();

    test.beforeEach(async ({ page }) => {
        await seed(page, {
            user: "uid2",
            local: { mockFsHang: "1" },
            data: withSpots({
                admin: { uid2: { name: "管理者" } },
                user: { uid2: PROFILE("テスト巡礼者", "p@x.jp") },
                stamp: {
                    t1: mine({ spot_id: { __ref: "spot/s13" }, time_stamp: { __ts: 1760000000000 } }),
                    t2: mine({ spot_id: { __ref: "spot/s13" }, time_stamp: { __ts: 1760100000000 } })
                },
                favorite: { uid2_s12: mine({ spot_id: { __ref: "spot/s12" }, time_stamp: { __ts: 1760000000000 } }) },
                root: { r1: mine({ save_spot: ["s14", "s13"], time_stamp: { __ts: 1760000000000 } }) },
                message: { m1: mine({ title: "申請が承認されました", body: "本文", created_at: { __ts: 1760000000000 }, is_read: false }) }
            })
        });
    });

    test("スタンプ帳", async ({ page, restCalls }) => {
        await page.goto("html/stamp.html");
        await expect(page.locator("main")).toContainText("宇治橋", { timeout: 30_000 });
        expect(restCalls).toContain("POST :runQuery +token");
    });

    test("マイページ（管理者メニュー・未読の数）", async ({ page }) => {
        await page.goto("html/mypage.html");
        await expect(page.locator("#admin-menu")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#inbox-badge")).toHaveText("1", { timeout: 30_000 });
    });

    test("お気に入り・ルート・履歴", async ({ page }) => {
        await page.goto("html/history.html");
        await expect(page.locator("#saved-main")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator(".tab-count")).toHaveText(["1", "1", "0", "1"]);
    });

    test("お知らせ", async ({ page }) => {
        await page.goto("html/inbox.html");
        await expect(page.locator("#inbox-list")).toContainText("申請が承認されました", { timeout: 30_000 });
    });
});
