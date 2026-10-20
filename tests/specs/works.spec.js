// 作品一覧・作品ごとのページ
import { test, expect, seed, withSpots, PROFILE, SPOTS } from "../helpers.js";

const EUPHO = "響け！ユーフォニアム";
const titles = [...new Set(SPOTS.map((spot) => spot.title_name))];

test("作品一覧に作品が並び、名前で絞り込める", async ({ page }) => {
    await seed(page);
    await page.goto("html/works.html");
    await expect(page.locator("#work-list .work-card")).toHaveCount(titles.length);

    await page.fill("#work-search", "ユーフォ");
    await expect(page.locator(".work-card h2")).toHaveText([EUPHO]);
});

test("作品ページに、その作品の聖地・おすすめルート・スタンプの進み具合が出る", async ({ page }) => {
    const eupho = SPOTS.filter((spot) => spot.title_name === EUPHO);
    await seed(page, {
        user: "uid2",
        data: withSpots({
            user: { uid2: PROFILE("巡礼者", "p@x.jp") },
            course: { c1: { title_name: EUPHO, course_name: "宇治駅から大吉山へ", description: "半日コース", spot_ids: eupho.slice(0, 3).map((s) => s.id), updated_at: { __ts: 1 } } },
            stamp: { t1: { user_id: { __ref: "user/uid2" }, spot_id: { __ref: "spot/" + eupho[0].id }, time_stamp: { __ts: 1 } } }
        })
    });
    await page.goto("html/work.html?title=" + encodeURIComponent(EUPHO));
    await expect(page.locator("#work-main")).toBeVisible();
    await expect(page.locator("#work-hero")).toContainText(EUPHO);
    await expect(page.locator("#work-hero")).toContainText("1");
    await expect(page.locator(".work-spot")).toHaveCount(eupho.length);
    await expect(page.locator(".work-route")).toContainText("宇治駅から大吉山へ");
    await expect(page.locator("#work-map")).toHaveAttribute("href", /map\.html\?work=/);
});

test("ない作品のページは、見つからないと出る", async ({ page }) => {
    await seed(page);
    await page.goto("html/work.html?title=" + encodeURIComponent("存在しない作品"));
    await expect(page.locator("#work-notice")).toContainText("見つかりませんでした");
});
