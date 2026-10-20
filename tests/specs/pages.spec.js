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
