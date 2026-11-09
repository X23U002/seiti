// 使う人の目線での改善：はじめての説明・現在地の聞き方・元に戻す・ログインの案内・
// 詳細のボタンの固定・画面下のタブ・ピンの文字・検索欄の説明
import { test, expect, seed, withSpots, PROFILE, spotNamed, SPOTS } from "../helpers.js";

const pins = (page) => page.locator(".mapboxgl-marker[data-spot-id]");
const [station, bridge] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
const route = withSpots({
    course: { c1: { title_name: station.title_name, course_name: "2か所", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } }
});

test("はじめて開いた時だけ、使い方を説明してから現在地を使うか聞く", async ({ page }) => {
    await seed(page, { local: { seitiOnboarded: "", seitiLocationAskedAt: "" } });
    await page.goto("html/map.html");
    const guide = page.locator(".onboarding");
    await expect(guide).toBeVisible();
    await expect(guide.locator(".onboarding-title")).toHaveText("聖地を探す");
    await guide.locator(".onboarding-primary", { hasText: "次へ" }).click();
    await expect(guide.locator(".onboarding-title")).toHaveText("ルートを作って巡る");
    await guide.locator(".onboarding-secondary", { hasText: "スキップ" }).click();
    await expect(guide.locator(".onboarding-title")).toHaveText("現在地を使いますか？");
    await guide.locator(".onboarding-secondary", { hasText: "あとで" }).click();
    await expect(guide).toHaveCount(0);

    // 2回目は出さない（あとでにしたので、現在地の案内も1週間は出さない）
    await page.reload();
    await expect(pins(page)).toHaveCount(SPOTS.length);
    await expect(page.locator(".onboarding, .location-card")).toHaveCount(0);
});

test("2回目からは、現在地を許可していなければ理由を書いた小さな案内を出す（地図は使えるまま）", async ({ page }) => {
    await seed(page, { local: { seitiLocationAskedAt: "" } });
    await page.goto("html/map.html");
    const card = page.locator(".location-card");
    await expect(card).toContainText("スタンプが押せて、現在地からの道案内も使えます");
    await expect(page.locator(".onboarding")).toHaveCount(0);
    await card.locator("button", { hasText: "あとで" }).click();
    await expect(card).toHaveCount(0);
});

test.describe("現在地を許可済みの時", () => {
    test.use({ geolocation: { latitude: station.coord.latitude, longitude: station.coord.longitude }, permissions: ["geolocation"] });

    test("説明も案内も出さず、これまでどおりすぐ現在地を取る", async ({ page }) => {
        await seed(page, { local: { seitiOnboarded: "", seitiLocationAskedAt: "" } });
        await page.goto("html/map.html");
        await expect(pins(page)).toHaveCount(SPOTS.length);
        await expect(page.locator(".onboarding, .location-card")).toHaveCount(0);
        await expect(page.locator(".mapboxgl-user-location-dot").first()).toBeAttached();
    });
});

test("ルート案内の全削除・×は、「元に戻す」で戻せる", async ({ page }) => {
    await seed(page, { data: route });
    await page.goto("html/map.html?course=c1");
    const items = page.locator("#routeList .routeItem");
    await expect(items).toHaveCount(2);

    await page.click("#clear-route");
    await expect(page.locator("#routePanel")).toBeHidden();
    await expect(page.locator("#toast")).toContainText("ルートを全削除しました");
    await page.locator("#toast .toast-action", { hasText: "元に戻す" }).click();
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText(station.spot_name);
    await expect(page.locator("#toast")).toContainText("元に戻しました");

    await page.locator('#routeList .routeItem[data-index="0"] .route-remove').click();
    await expect(items).toHaveCount(1);
    await expect(page.locator("#toast")).toContainText(`「${station.spot_name}」をルートから外しました`);
    await page.locator("#toast .toast-action").click();
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText(station.spot_name);
});

test("ログインが必要な機能は「ログインする」ボタン付きで知らせ、ログインしたら元の画面に戻る", async ({ page }) => {
    await seed(page, { users: { "p@x.jp": { uid: "uid2", password: "secret1" } }, data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
    await page.goto("html/map.html?spot=" + bridge.id);
    await page.locator(".popup-card .popup-fav").click();
    const login = page.locator("#toast .toast-action", { hasText: "ログインする" });
    await expect(page.locator("#toast")).toContainText("お気に入りはログインすると使えます");
    await expect(login).toHaveAttribute("href", "login.html?next=" + encodeURIComponent("map.html?spot=" + bridge.id));

    await login.click();
    await page.fill("#email", "p@x.jp");
    await page.fill("#password", "secret1");
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(new RegExp("map\\.html\\?spot=" + bridge.id + "$"));
    await expect(page.locator(".popup-card")).toBeVisible();
});

test("ログイン後に開くページは、このアプリのページだけ", async ({ page }) => {
    await seed(page, { users: { "p@x.jp": { uid: "uid2", password: "secret1" } }, data: withSpots({ user: { uid2: PROFILE("巡礼者", "p@x.jp") } }) });
    await page.goto("html/login.html?next=" + encodeURIComponent("https://example.com/"));
    await page.fill("#email", "p@x.jp");
    await page.fill("#password", "secret1");
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/html\/map\.html$/);
});

test("聖地の詳細では、スタンプとルートに追加のボタンがスクロールしなくても見える", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(page.locator(".popup-card")).toBeVisible();
    await expect(page.locator(".popup-action-bar .stamp-button")).toBeInViewport();
    await expect(page.locator(".popup-action-bar button[id^='route-btn-']")).toBeInViewport();
});

test("スマホの画面下のタブで、地図・作品・スタンプ・マイページへ移れる", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html");
    const tabs = page.locator(".tab-bar .tab-bar-item");
    await expect(tabs).toHaveText(["地図", "作品", "スタンプ", "マイページ"]);
    await expect(tabs.first()).toHaveAttribute("aria-current", "page");
    // 地図の下のボタンは、タブに重ならない
    const bar = await page.locator(".tab-bar").boundingBox();
    const view = await page.locator("#toggle-view-btn").boundingBox();
    expect(view.y + view.height).toBeLessThanOrEqual(bar.y);

    await tabs.nth(1).click();
    await expect(page).toHaveURL(/works\.html$/);
    await expect(page.locator(".tab-bar-item[aria-current=page]")).toHaveText("作品");

    // 聖地の詳細を開いている間は隠す
    await page.goto("html/map.html?spot=" + bridge.id);
    await expect(page.locator(".popup-card")).toBeVisible();
    await expect(page.locator(".tab-bar")).toBeHidden();
});

test("ピンに作品名の1文字目が入り、検索欄の説明は切れない長さ", async ({ page }) => {
    await seed(page);
    await page.goto("html/map.html");
    await expect(pins(page)).toHaveCount(SPOTS.length);
    await expect(page.locator(`.mapboxgl-marker[data-spot-id="${bridge.id}"] .pin-initial`)).toHaveText("響");
    const oshi = SPOTS.find((spot) => spot.title_name === "【推しの子】");
    await expect(page.locator(`.mapboxgl-marker[data-spot-id="${oshi.id}"] .pin-initial`)).toHaveText("推");
    await expect(page.locator(".mapboxgl-ctrl-geocoder input")).toHaveAttribute("placeholder", "聖地・駅・住所で検索");
});
