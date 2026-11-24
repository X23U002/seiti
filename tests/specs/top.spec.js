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
    // 聖地の多い作品から並べ、押すとその作品のページへ
    const first = await chips.first().getAttribute("href");
    expect(first).toMatch(/^map画面\/html\/work\.html\?title=/);
    const counts = await page.locator(".work-chip-count").allTextContents();
    const numbers = counts.map((text) => parseInt(text, 10));
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
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
