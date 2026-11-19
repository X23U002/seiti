// 自動テストの設定（tests/ で npm test）
// map画面/ を小さなサーバーで配り、外部（Firebase・Mapbox）はすべて helpers.js で差しかえる
import { defineConfig } from "@playwright/test";

// オフライン用の service worker が出す通信も、テストの差しかえ（helpers.js の context.route）で受ける
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

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
        // オフライン用の service worker（sw.js）はふだん止める（差しかえた通信が素通りしないように）。
        // 確かめるテスト（pwa.spec.js）だけ動かす
        serviceWorkers: "block",
        trace: "retain-on-failure"
    },
    webServer: {
        command: `python3 -m http.server ${PORT} --directory ../map画面`,
        url: `http://localhost:${PORT}/html/guide.html`,
        reuseExistingServer: !process.env.CI
    }
});
