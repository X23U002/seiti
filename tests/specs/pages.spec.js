// すべての画面が、エラーなしで開けること
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, seed, withSpots, PROFILE } from "../helpers.js";

const htmlDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../map画面/html");
const pages = fs.readdirSync(htmlDir).filter((name) => name.endsWith(".html"));

for (const user of [null, "uid2"]) {
    for (const name of pages) {
        test(`${name}（${user ? "ログイン中" : "未ログイン"}）`, async ({ page }) => {
            await seed(page, { user, data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
            await page.goto("html/" + name);
            await expect(page).toHaveTitle(/.+/);
            // 読み込み後に動く処理のエラーも拾う
            await page.waitForTimeout(1500);
        });
    }
}

test.describe("スマホの上の「＜ 戻る」", () => {
    test.use({ viewport: { width: 390, height: 760 } });

    test("下のタブで行ける画面では出さない。1つ下の画面では行き先を書いて出す", async ({ page }) => {
        await seed(page, { data: withSpots({}) });
        for (const url of ["html/works.html", "html/stamp.html", "html/mypage.html"]) {
            await page.goto(url);
            await expect(page.locator(".tab-bar")).toBeVisible();
            await expect(page.locator(".back-btn")).toBeHidden();
        }
        await page.goto("html/history.html");
        await expect(page.locator(".back-btn")).toHaveText("＜ マイページ");
        await expect(page.locator(".back-btn")).toBeVisible();
    });

    test("広い画面（下のタブが無い）では、上の「＜ 戻る」を出す", async ({ page }) => {
        await page.setViewportSize({ width: 1100, height: 760 });
        await seed(page, { data: withSpots({}) });
        await page.goto("html/stamp.html");
        await expect(page.locator(".back-btn")).toHaveText("＜ マイページ");
        await expect(page.locator(".back-btn")).toBeVisible();
    });
});

test("お気に入り・履歴のタブは、中身が分かる名前", async ({ page }) => {
    await seed(page, { user: "uid2", data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
    await page.goto("html/history.html");
    await expect(page.locator(".saved-tab")).toHaveText([/お気に入り/, /保存ルート/, /案内ルート/, /行った聖地/]);
});

test("操作ガイドに書いたボタンの名前が、実際の画面と同じ", async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../map画面");
    const guide = fs.readFileSync(path.join(root, "html/guide.html"), "utf8");
    // 地図の画面（HTML と、ボタンを作る JavaScript）
    const app = ["html/map.html", "js/Script.js", "js/my-plan.js", "js/stampsyori.js"]
        .map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
    for (const label of ["🚶 道順を地図に出す", "マイプランを作ってもらう", "このプランで巡る", "📍 現在地を確かめる", "＋ 現在地から出発する", "作品で絞り込み", "おすすめルート"]) {
        expect(guide, `ガイドに「${label}」`).toContain(label);
        expect(app, `画面に「${label}」`).toContain(label);
    }
    // AI のプランは、作品ページではなくおすすめルートの画面にある
    expect(guide).not.toContain("AI におまかせプラン");
});

test("操作ガイド・お問い合わせの上の「＜ 戻る」は、開いた所（マイページ・地図）に戻る", async ({ page }) => {
    await seed(page, { data: withSpots({}) });
    for (const url of ["html/guide.html", "html/information.html"]) {
        await page.goto(url + "?from=mypage");
        await expect(page.locator(".back-btn")).toHaveText("＜ マイページ");
        await expect(page.locator(".back-btn")).toHaveAttribute("href", "mypage.html");
        // 地図のメニューから開いた時（from なし）は、今までどおり地図へ
        await page.goto(url);
        await expect(page.locator(".back-btn")).toHaveText("＜ マップ");
        await expect(page.locator(".back-btn")).toHaveAttribute("href", "map.html");
    }
});
