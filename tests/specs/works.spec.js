// 作品一覧・作品ごとのページ
import { test, expect, seed, withSpots, readStore, PROFILE, SPOTS } from "../helpers.js";

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

test("管理ページの「作品」で書いた説明が、作品ページの見出しの下に出る", async ({ page }) => {
    const KIMETSU = "鬼滅の刃";
    await seed(page, {
        user: "uid1",
        data: withSpots({
            admin: { uid1: { name: "管理者" } },
            user: { uid1: PROFILE("管理者", "a@x.jp") },
            work: { w1: { title_name: KIMETSU, description: "大正時代の日本が舞台。", updated_at: { __ts: 1 } } }
        })
    });

    // 説明のない作品には出さない
    await page.goto("html/work.html?title=" + encodeURIComponent(EUPHO));
    await expect(page.locator("#work-title")).toHaveText(EUPHO);
    await expect(page.locator("#work-description")).toBeHidden();

    await page.goto("html/admin.html");
    await page.click("#tab-works");
    // 説明を書いた作品には ✓ が付き、選ぶと今の説明が出る
    await expect(page.locator("#work-title option", { hasText: KIMETSU })).toHaveText("✓ " + KIMETSU);
    await page.selectOption("#work-title", KIMETSU);
    await expect(page.locator("#work-description")).toHaveValue("大正時代の日本が舞台。");

    await page.selectOption("#work-title", EUPHO);
    await expect(page.locator("#work-description")).toHaveValue("");
    await page.fill("#work-description", "京都府宇治市が舞台。\n高校の吹奏楽部の物語。  ");
    await expect(page.locator("#work-count")).toHaveText("24 / 1000文字");
    await page.click("#work-save");
    await expect(page.locator("#toast")).toContainText("説明を保存しました");
    await expect(page.locator("#work-title option", { hasText: EUPHO })).toHaveText("✓ " + EUPHO);

    const works = Object.values((await readStore(page)).work);
    expect(works).toHaveLength(2);
    expect(works.find((work) => work.title_name === EUPHO).description).toBe("京都府宇治市が舞台。\n高校の吹奏楽部の物語。");

    // 書き直すと、同じドキュメントを上書きする
    await page.fill("#work-description", "京都府宇治市が舞台の青春物語。");
    await page.click("#work-save");
    await expect(page.locator("#toast")).toContainText("説明を保存しました");
    expect(Object.values((await readStore(page)).work)).toHaveLength(2);

    await page.goto("html/work.html?title=" + encodeURIComponent(EUPHO));
    await expect(page.locator("#work-description")).toBeVisible();
    await expect(page.locator("#work-description")).toHaveText("京都府宇治市が舞台の青春物語。");
});

