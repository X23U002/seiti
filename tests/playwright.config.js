// 自動テストの設定（tests/ で npm test）
// map画面/ を小さなサーバーで配り、外部（Firebase・Mapbox）はすべて helpers.js で差しかえる
import { defineConfig } from "@playwright/test";

const PORT = 8765;

export default defineConfig({
    testDir: "./specs",
    timeout: 60_000,
    expect: { timeout: 15_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
    use: {
        baseURL: `http://localhost:${PORT}/`,
        viewport: { width: 390, height: 780 },
        trace: "retain-on-failure"
    },
    webServer: {
        command: `python3 -m http.server ${PORT} --directory ../map画面`,
        url: `http://localhost:${PORT}/html/guide.html`,
        reuseExistingServer: !process.env.CI
    }
});
