import { test } from "../helpers.js";
for (const [n, w, h] of [["sp", 390, 844], ["pc", 1280, 800]]) test("top " + n, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("../index.html").catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: "/tmp/claude-0/-home-user/a74e9693-467b-59d5-8301-af1951745b99/scratchpad/top-" + n + ".png", fullPage: true });
    console.log("URL", page.url());
});
