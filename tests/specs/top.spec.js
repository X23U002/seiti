// トップページ（リポジトリの一番上の index.html）
// テスト用のサーバーは map画面/ だけを出すので、トップページはテストの中でファイルを返して開く
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, SPOTS } from "../helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const TOP = "http://site.test/index.html";

async function serveTop(page) {
    await page.context().route("http://site.test/**", (route) => {
        const file = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
    });
}

const works = new Set(SPOTS.map((spot) => spot.title_name || "その他"));

test("一番大きいボタンは「地図をひらく」。ログイン・新規登録はその下に小さく出す", async ({ page }) => {
    await serveTop(page);
    await page.goto(TOP);
    const map = page.locator("#hero-guest .btn-map");
    await expect(map).toHaveText("地図をひらく");
    await expect(map).toHaveAttribute("href", "./map画面/html/map.html");
    await expect(page.locator("#hero-guest .hero-account a")).toHaveText(["ログイン", "新規登録"]);
    await expect(page.locator("#hero-member")).toBeHidden();
    // 最後のボタンも地図へ
    await expect(page.locator(".cta .btn")).toHaveAttribute("href", "./map画面/html/map.html");
});

test("ログインしている人には、名前と「スタンプ帳」「マイページ」を出す", async ({ page }) => {
    await serveTop(page);
    await page.goto(TOP);
    await page.evaluate(() => {
        localStorage.setItem("seitiCurrentUserId", "uid2");
        localStorage.setItem("seitiAccount", JSON.stringify({ nickname: "巡礼者", email: "p@x.jp" }));
    });
    await page.reload();
    await expect(page.locator("#hero-member")).toBeVisible();
    await expect(page.locator("#hero-member .hero-welcome")).toHaveText("巡礼者さん、おかえりなさい");
    await expect(page.locator("#hero-member .hero-account a")).toHaveText(["スタンプ帳", "マイページ"]);
    await expect(page.locator("#hero-guest")).toBeHidden();
});

test("対応作品と聖地の数を、データベースから読んで作品の色の札で出す", async ({ page }) => {
    await serveTop(page);
    await page.goto(TOP);
    await expect(page.locator("#works")).toBeVisible();
    await expect(page.locator("#spots-count")).toHaveText(String(SPOTS.length));
    await expect(page.locator("#works-count")).toHaveText(String([...works].filter((title) => title !== "その他").length));
    const chips = page.locator(".work-chip");
    await expect(chips).toHaveCount(works.size);
    // 聖地の多い作品から並べる
    // 札は押しても作品の紹介ページへ飛ばない（リンクにしない）
    await expect(page.locator("#works-list a")).toHaveCount(0);
    await chips.first().click();
    await expect(page).toHaveURL(TOP);
    const counts = await page.locator(".work-chip-count").allTextContents();
    const numbers = counts.map((text) => parseInt(text, 10));
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    await expect(page.locator(".work-chip.is-skeleton")).toHaveCount(0);
});

test("対応作品は読み込む前から欄を出し（札の形で場所を取る）、2回目からは前に読んだ作品をすぐ出して下がずれない", async ({ page }) => {
    await serveTop(page);
    // データベースの答えを止めておく
    let release;
    let held = new Promise((resolve) => { release = resolve; });
    await page.route(/firestore\.googleapis\.com/, async (route) => { await held; await route.fallback(); });
    await page.goto(TOP);
    // 初めての時：読み込む前から欄があり、札の形で場所を取っておく
    await expect(page.locator("#works")).toBeVisible();
    await expect(page.locator(".work-chip.is-skeleton")).not.toHaveCount(0);
    release();
    await expect(page.locator("#spots-count")).toHaveText(String(SPOTS.length));
    await expect(page.locator(".work-chip.is-skeleton")).toHaveCount(0);

    // 2回目：読み込む前から前に読んだ作品が出ていて、読み終わっても下の「画面のようす」はずれない
    held = new Promise((resolve) => { release = resolve; });
    await page.reload();
    await expect(page.locator("#spots-count")).toHaveText(String(SPOTS.length));
    await expect(page.locator(".work-chip.is-skeleton")).toHaveCount(0);
    const before = await page.locator(".screens").evaluate((el) => el.getBoundingClientRect().top);
    release();
    await page.waitForTimeout(500);
    const after = await page.locator(".screens").evaluate((el) => el.getBoundingClientRect().top);
    expect(after).toBe(before);
});

test("対応作品が読めない時も欄は残し、読めなかったことを知らせる", async ({ page }) => {
    await serveTop(page);
    await page.route(/firestore\.googleapis\.com/, (route) => route.fulfill({ status: 500, body: "" }));
    await page.goto(TOP);
    await expect(page.locator("#works")).toBeVisible();
    await expect(page.locator("#works-lead")).toContainText("読み込めませんでした");
    await expect(page.locator(".work-chip.is-skeleton")).toHaveCount(0);
});

test("画面のようすの画像と、LINE などで送った時の画像（OGP）がある", async ({ page }) => {
    await serveTop(page);
    await page.goto(TOP);
    const images = page.locator(".screen img");
    await expect(images).toHaveCount(6);
    for (const src of await images.evaluateAll((list) => list.map((img) => img.getAttribute("src")))) {
        expect(fs.existsSync(path.join(ROOT, src.split("?")[0]))).toBe(true);
    }
    // 遅れて読む（loading="lazy"）ので、1枚ずつ見える所まで動かして確かめる
    for (let i = 0; i < 6; i++) {
        await images.nth(i).scrollIntoViewIfNeeded();
        await expect.poll(() => images.nth(i).evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    }
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(ogImage).toBe("https://x23u002.github.io/seiti/map画面/images/top/ogp.jpg");
    expect(fs.existsSync(path.join(ROOT, "map画面/images/top/ogp.jpg"))).toBe(true);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});

test("巡礼のマナーを出す。広い画面ではQRコード、ホーム画面に追加の案内は出さない", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await serveTop(page);
    await page.goto(TOP);
    await expect(page.locator(".manners-list li")).toHaveCount(4);
    await expect(page.locator(".phone-section")).toBeVisible();
    await expect(page.locator(".install-section")).toBeHidden();
});

test.describe("iPhone", () => {
    test.use({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    });

    test("スマホでは、QRコードの代わりにホーム画面に追加の案内（iPhone の書き方）を出す", async ({ page }) => {
        await serveTop(page);
        await page.goto(TOP);
        await expect(page.locator(".phone-section")).toBeHidden();
        await expect(page.locator('[data-install="ios"]')).toBeVisible();
        await expect(page.locator('[data-install="android"]')).toBeHidden();
        // できることは1列で、見出しが途中で折り返さない
        const heights = await page.locator(".feature h3").evaluateAll((list) => list.map((h) => h.getBoundingClientRect().height));
        heights.forEach((height) => expect(height).toBeLessThan(30));
    });
});

test("トップページから開いた操作ガイド・お問い合わせは、上の「＜ トップ」でトップページに戻れる", async ({ page }) => {
    await serveTop(page);
    await page.goto(TOP);
    await page.locator(".guide-link a").click();
    await expect(page).toHaveURL(/guide\.html\?from=top$/);
    const back = page.locator(".back-btn");
    await expect(back).toHaveText("＜ トップ");
    await back.click();
    await expect(page).toHaveURL(TOP);

    await page.locator(".footer-links a", { hasText: "お問い合わせ" }).click();
    await expect(page).toHaveURL(/information\.html\?from=top$/);
    await expect(back).toHaveText("＜ トップ");
    await back.click();
    await expect(page).toHaveURL(TOP);
});
