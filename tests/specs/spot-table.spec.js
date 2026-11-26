// 聖地の一括編集（表で直す・行を足す・CSV の書き出しと読み込み）
import { test, expect, seed, withSpots, readStore, PROFILE, spotNamed, SPOTS } from "../helpers.js";

const adminData = () => withSpots({
    admin: { uid1: { name: "管理者" } },
    user: { uid1: PROFILE("管理者", "a@x.jp"), uid2: PROFILE("巡礼者", "p@x.jp") }
});

async function openTable(page) {
    await seed(page, { user: "uid1", data: adminData() });
    await page.goto("html/spot-table.html");
    await expect(page.locator("#table-main")).toBeVisible();
}

// ID で探して、その聖地の行を返す
async function rowOf(page, id) {
    await page.fill("#filter-text", id);
    const row = page.locator("#spot-rows tr").first();
    await expect(row.locator('[data-field="id"]')).toHaveValue(id);
    return row;
}

test("管理者でない人には表を出さない", async ({ page }) => {
    await seed(page, { user: "uid2", data: adminData() });
    await page.goto("html/spot-table.html");
    await expect(page.locator("#table-notice")).toContainText("管理者だけ");
    await expect(page.locator("#table-main")).toBeHidden();
});

test("表で書きかえて保存すると、変えた項目だけが保存される", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);
    await expect(page.locator("#table-status")).toContainText("全" + SPOTS.length + "件");

    const row = await rowOf(page, bridge.id);
    await row.locator('[data-field="spot_info"]').fill("新しい説明");
    await expect(row).toHaveClass(/is-changed/);
    await expect(page.locator("#save-all")).toHaveText("保存する（1件）");

    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("1件の聖地を保存しました");
    await expect(page.locator("#save-all")).toHaveText("変更はありません");

    const saved = (await readStore(page)).spot[bridge.id];
    expect(saved.spot_info).toBe("新しい説明");
    expect(saved.spot_name).toBe(bridge.spot_name);
    expect(saved.coord).toEqual(bridge.coord);
});

test("行を足して保存すると、新しい聖地ができる（ID・公式サイト・場所も入る）。場所が無いと保存しない", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);
    await page.click("#add-row");
    const row = page.locator("#spot-rows tr.is-new");
    await row.locator('[data-field="title_name"]').fill(bridge.title_name);
    await row.locator('[data-field="spot_name"]').fill("テストの聖地");
    await row.locator('[data-field="spot_info"]').fill("1期1話。テスト。");

    // 場所が無いと赤くなって保存しない
    await page.click("#save-all");
    await expect(row).toHaveClass(/has-error/);
    await expect(row.locator(".row-error")).toContainText("緯度・経度");

    await row.locator('[data-field="latitude"]').fill("34.89");
    await row.locator('[data-field="longitude"]').fill("135.80");
    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("1件の聖地を保存しました");

    const store = await readStore(page);
    const created = Object.entries(store.spot).find(([, spot]) => spot.spot_name === "テストの聖地");
    expect(created[0]).toMatch(/^s\d{4}$/);
    expect(created[1]).toMatchObject({
        title_name: bridge.title_name,
        coord: { latitude: 34.89, longitude: 135.8 },
        image_url: "no_image",
        title_url: bridge.title_url
    });
    expect(created[1].geo_hash).toMatch(/^[0-9a-z]{8}$/);
});

test("CSV を読み込むと、ID のある行は書きかえ、ID が空の行は新しい聖地として表に入る（保存は押してから）", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);
    const csv = "﻿ID,作品名,スポット名,説明,緯度,経度\r\n" +
        `${bridge.id},${bridge.title_name},${bridge.spot_name},"CSV で直した説明, カンマ入り",,\r\n` +
        `,${bridge.title_name},CSVの新しい聖地,"2行の
説明",34.9,135.81\r\n`;
    await page.setInputFiles("#import-csv", { name: "spots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.locator("#toast")).toContainText("変更 1件・追加 1件");
    await expect(page.locator("#save-all")).toHaveText("保存する（2件）");
    // 読み込んだだけでは保存しない
    expect((await readStore(page)).spot[bridge.id].spot_info).toBe(bridge.spot_info);

    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("2件の聖地を保存しました");
    const store = await readStore(page);
    expect(store.spot[bridge.id].spot_info).toBe("CSV で直した説明, カンマ入り");
    const created = Object.values(store.spot).find((spot) => spot.spot_name === "CSVの新しい聖地");
    expect(created.spot_info).toBe("2行の\n説明");
});

test("CSV を書き出すと、全部の聖地が見出し付きで入る", async ({ page }) => {
    await openTable(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-csv")]);
    expect(download.suggestedFilename()).toMatch(/^seiti-spots-\d{8}\.csv$/);
    const text = (await (await download.createReadStream()).toArray()).join("");
    expect(text.startsWith("﻿ID,作品名,スポット名,説明,期,話,緯度,経度,画像,公式サイト")).toBe(true);
    // 作品の公式サイトも書き出す
    expect(text).toContain(spotNamed("宇治橋").title_url);
    expect(text).toContain(spotNamed("宇治橋").spot_name);
});

test("登録済みの聖地の緯度・経度を直すと、場所と geo_hash が保存される", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);
    const row = await rowOf(page, bridge.id);
    await row.locator('[data-field="latitude"]').fill("34.9");
    await row.locator('[data-field="longitude"]').fill("135.81");
    await expect(row).toHaveClass(/is-changed/);
    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("1件の聖地を保存しました");

    const saved = (await readStore(page)).spot[bridge.id];
    expect(saved.coord).toEqual({ latitude: 34.9, longitude: 135.81 });
    expect(saved.geo_hash).not.toBe(bridge.geo_hash);
    expect(saved.spot_name).toBe(bridge.spot_name);
});

test("ID を変えると、新しい ID で作り直して古い聖地を消し、おすすめルートの ID も付け替える", async ({ page }) => {
    const [station, bridge] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
    const data = adminData();
    data.course = { c1: { title_name: bridge.title_name, course_name: "テスト", description: "", spot_ids: [station.id, bridge.id], updated_at: { __ts: 1 } } };
    await seed(page, { user: "uid1", data });
    await page.goto("html/spot-table.html");
    await expect(page.locator("#table-main")).toBeVisible();

    const row = await rowOf(page, bridge.id);
    await row.locator('[data-field="id"]').fill("s0799");
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("おすすめルート 1件の ID も付け替えました");

    const store = await readStore(page);
    expect(store.spot[bridge.id]).toBeUndefined();
    expect(store.spot.s0799).toMatchObject({ spot_name: bridge.spot_name, spot_info: bridge.spot_info, coord: bridge.coord });
    expect(store.course.c1.spot_ids).toEqual([station.id, "s0799"]);
});

test("ほかの聖地が使っている ID や、形の違う ID には変えられない", async ({ page }) => {
    const [station, bridge] = ["京阪宇治駅", "宇治橋"].map(spotNamed);
    await openTable(page);
    const row = await rowOf(page, bridge.id);
    await row.locator('[data-field="id"]').fill(station.id);
    await page.click("#save-all");
    await expect(row.locator(".row-error")).toContainText("ほかの聖地で使っています");

    await row.locator('[data-field="id"]').fill("ア イ");
    await page.click("#save-all");
    await expect(row.locator(".row-error")).toContainText("半角の英数字");
    expect((await readStore(page)).spot[bridge.id]).toBeDefined();
});

test("新しい行に ID を入れると、その ID で登録される（空なら自動）", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);
    await page.click("#add-row");
    const row = page.locator("#spot-rows tr.is-new");
    await expect(row.locator('[data-field="id"]')).toHaveAttribute("placeholder", "自動");
    await row.locator('[data-field="id"]').fill("s0799");
    await row.locator('[data-field="title_name"]').fill(bridge.title_name);
    await row.locator('[data-field="spot_name"]').fill("ID を決めた聖地");
    await row.locator('[data-field="spot_info"]').fill("説明");
    await row.locator('[data-field="latitude"]').fill("34.89");
    await row.locator('[data-field="longitude"]').fill("135.80");
    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("1件の聖地を保存しました");

    expect((await readStore(page)).spot.s0799).toMatchObject({ spot_name: "ID を決めた聖地", title_name: bridge.title_name });
    await expect(page.locator("#spot-rows tr", { has: page.locator('[data-field="spot_name"]') }).first()).toBeVisible();
});

test("画像を表で入れて保存できる（見本で確かめられる）。新しい聖地・CSV でも入る", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);

    // 登録済みの聖地：ファイルの場所を入れると見本が出て、保存すると image_url が入る
    const row = await rowOf(page, bridge.id);
    const image = row.locator('[data-field="image"]');
    await image.fill("eupho/eupho_s0702.jpg");
    await expect(row.locator(".image-preview img")).toHaveAttribute("src", "../images/spots/eupho/eupho_s0702.jpg");
    await expect.poll(() => row.locator(".image-preview img").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(image).toHaveClass(/is-changed-cell/);

    // 無いファイルは「見つかりません」
    await image.fill("eupho/nothing.jpg");
    await expect(row.locator(".image-missing")).toHaveText("見つかりません");

    // GitHub の画像ページのURLでも入れられる
    await image.fill("https://github.com/X23U002/seiti/blob/main/map画面/images/spots/eupho/eupho_s0702.jpg");
    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("1件の聖地を保存しました");
    expect((await readStore(page)).spot[bridge.id].image_url).toBe("images/spots/eupho/eupho_s0702.jpg");
    // 保存した後は、短い形で出る
    await expect(image).toHaveValue("eupho/eupho_s0702.jpg");

    // 新しい聖地にも入る
    await page.fill("#filter-text", "");
    await page.click("#add-row");
    const added = page.locator("#spot-rows tr.is-new");
    await added.locator('[data-field="title_name"]').fill(bridge.title_name);
    await added.locator('[data-field="spot_name"]').fill("画像つきの聖地");
    await added.locator('[data-field="spot_info"]').fill("説明");
    await added.locator('[data-field="latitude"]').fill("34.89");
    await added.locator('[data-field="longitude"]').fill("135.80");
    await added.locator('[data-field="image"]').fill("eupho/eupho_s0703.jpg");
    await page.click("#save-all");
    await expect.poll(async () => Object.values((await readStore(page)).spot).some((spot) => spot.spot_name === "画像つきの聖地")).toBe(true);
    const created = Object.values((await readStore(page)).spot).find((spot) => spot.spot_name === "画像つきの聖地");
    expect(created.image_url).toBe("images/spots/eupho/eupho_s0703.jpg");

    // CSV の「画像」の列でも入る
    const csv = "\ufeffID,作品名,スポット名,説明,緯度,経度,画像\r\n" +
        `${bridge.id},${bridge.title_name},${bridge.spot_name},${bridge.spot_info},,,eupho/eupho_s0701.jpg\r\n`;
    await page.setInputFiles("#import-csv", { name: "spots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.locator("#save-all")).toHaveText("保存する（1件）");
    await page.click("#save-all");
    await expect.poll(async () => (await readStore(page)).spot[bridge.id].image_url).toBe("images/spots/eupho/eupho_s0701.jpg");
});

test("何期の何話か（期・話）を表で入れて保存できる。数でなければ保存しない。新しい聖地・CSV でも入る", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);

    const row = await rowOf(page, bridge.id);
    await row.locator('[data-field="season"]').fill("abc");
    await page.click("#save-all");
    await expect(row.locator(".row-error")).toContainText("期は 0〜99 の数");

    // 全角の数字でも入る
    await row.locator('[data-field="season"]').fill("２");
    await row.locator('[data-field="episode"]').fill("13");
    await expect(row.locator('[data-field="episode"]')).toHaveClass(/is-changed-cell/);
    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("1件の聖地を保存しました");
    let saved = (await readStore(page)).spot[bridge.id];
    expect(saved.season).toBe(2);
    expect(saved.episode).toBe(13);
    await expect(row.locator('[data-field="season"]')).toHaveValue("2");

    // 空欄にすると「分からない」（0）
    await row.locator('[data-field="episode"]').fill("");
    await page.click("#save-all");
    // （前の「保存しました」が残っていることがあるので、保存した中身が変わるまで待つ）
    await expect.poll(async () => (await readStore(page)).spot[bridge.id].episode).toBe(0);
    await expect(page.locator("#save-all")).toHaveText("変更はありません");

    // 新しい聖地
    await page.fill("#filter-text", "");
    await page.click("#add-row");
    const added = page.locator("#spot-rows tr.is-new");
    await added.locator('[data-field="title_name"]').fill(bridge.title_name);
    await added.locator('[data-field="spot_name"]').fill("話数つきの聖地");
    await added.locator('[data-field="spot_info"]').fill("説明");
    await added.locator('[data-field="latitude"]').fill("34.89");
    await added.locator('[data-field="longitude"]').fill("135.80");
    await added.locator('[data-field="season"]').fill("1");
    await added.locator('[data-field="episode"]').fill("3");
    await page.click("#save-all");
    await expect.poll(async () => Object.values((await readStore(page)).spot).some((spot) => spot.spot_name === "話数つきの聖地")).toBe(true);
    const created = Object.values((await readStore(page)).spot).find((spot) => spot.spot_name === "話数つきの聖地");
    expect([created.season, created.episode]).toEqual([1, 3]);
    await expect(page.locator("#save-all")).toHaveText("変更はありません");

    // CSV の「期」「話」の列
    const csv = "\ufeffID,作品名,スポット名,説明,期,話\r\n" +
        `${bridge.id},${bridge.title_name},${bridge.spot_name},"${bridge.spot_info}",3,8\r\n`;
    await page.setInputFiles("#import-csv", { name: "spots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.click("#save-all");
    await expect.poll(async () => { const spot = (await readStore(page)).spot[bridge.id]; return [spot.season, spot.episode]; }).toEqual([3, 8]);
});

test("Excel で保存した CSV（Shift_JIS）も読み込めて、結果が画面に出る", async ({ page }) => {
    await openTable(page);
    // 「ID,作品名,スポット名,説明,期,話,緯度,経度,画像」と新しい聖地1行を Shift_JIS にしたもの
    const sjis = Buffer.from("49442c8dec956996bc2c8358837c8362836796bc2c90e096be2c8afa2c98622c88dc93782c8c6f93782c89e6919c0d0a2c8365835883678dec95692c83658358836790b9926e2c90e096be82c582b72c312c322c33352e302c3133352e382c0d0a", "hex");
    await page.setInputFiles("#import-csv", { name: "spots.csv", mimeType: "text/csv", buffer: sjis });
    const toast = page.locator("#toast");
    await expect(toast).toContainText("CSV を読み込みました：変更 0件・追加 1件");
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
    await expect(page.locator('#spot-rows [data-field="spot_name"]').first()).toHaveValue("テスト聖地");
});

test("CSV でまだ無い ID を入れた行は、その ID で新しい聖地として足す（知らせる）", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);
    const csv = "ID,作品名,スポット名,説明,緯度,経度\r\n" +
        `s0799,${bridge.title_name},ID を決めた聖地,説明,34.89,135.80\r\n` +
        `,${bridge.title_name},ID が空の聖地,説明,34.88,135.79\r\n`;
    await page.setInputFiles("#import-csv", { name: "spots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.locator("#toast")).toContainText("変更 0件・追加 2件");
    await expect(page.locator("#toast")).toContainText("新しい聖地として足しました：2行目（s0799）");
    await expect(page.locator("#save-all")).toHaveText("保存する（2件）");

    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("2件の聖地を保存しました");
    const store = await readStore(page);
    expect(store.spot.s0799).toMatchObject({ spot_name: "ID を決めた聖地", title_name: bridge.title_name });
    const auto = Object.entries(store.spot).find(([, spot]) => spot.spot_name === "ID が空の聖地");
    expect(auto[0]).toMatch(/^s\d{4,}$/);
    expect(auto[0]).not.toBe("s0799");
});

test("CSV で入れた ID の形がおかしい時は、保存せずにその行を赤くする", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);
    const csv = "ID,作品名,スポット名,説明,緯度,経度\r\n" +
        `ああ,${bridge.title_name},形のおかしい ID,説明,34.89,135.80\r\n`;
    await page.setInputFiles("#import-csv", { name: "spots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.click("#save-all");
    await expect(page.locator("#spot-rows tr.is-new .row-error")).toBeVisible();
    expect(Object.values((await readStore(page)).spot).some((spot) => spot.spot_name === "形のおかしい ID")).toBe(false);
});

test("作品の公式サイトを、CSV（「公式サイト」「HP」の列）と表で入れて保存できる。新しい聖地にも入る。URL でなければ保存しない", async ({ page }) => {
    const bridge = spotNamed("宇治橋");
    await openTable(page);
    const csv = "﻿ID,作品名,スポット名,説明,緯度,経度,HP\r\n" +
        `${bridge.id},${bridge.title_name},${bridge.spot_name},${bridge.spot_info},,,https://example.com/eupho\r\n` +
        ",新しい作品,新しい作品の聖地,説明,35.0,135.8,https://example.com/new\r\n" +
        ",新しい作品,新しい作品の聖地2,説明,35.01,135.8,\r\n";
    await page.setInputFiles("#import-csv", { name: "spots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.locator("#toast")).toContainText("変更 1件・追加 2件");

    // 表の作品名の下に出る（変えた所は色が付く）。新しい行は上に出るので、ID の欄で探す
    await page.fill("#filter-text", bridge.id);
    const index = await page.locator("#spot-rows tr").evaluateAll((trs, id) => trs.findIndex((tr) => tr.querySelector('[data-field="id"]').value === id), bridge.id);
    const row = page.locator("#spot-rows tr").nth(index);
    const url = row.locator('[data-field="title_url"]');
    await expect(url).toHaveValue("https://example.com/eupho");
    await expect(url).toHaveClass(/is-changed-cell/);

    // URL でなければ保存しない
    await url.fill("example.com");
    await page.fill("#filter-text", "");
    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("直すところがあります");
    await page.fill("#filter-text", bridge.id);
    await expect(row.locator(".row-error")).toContainText("公式サイトは http:// か https://");
    await url.fill("https://example.com/eupho");

    await page.fill("#filter-text", "");
    await page.click("#save-all");
    await expect(page.locator("#toast")).toContainText("3件の聖地を保存しました");
    const store = await readStore(page);
    expect(store.spot[bridge.id].title_url).toBe("https://example.com/eupho");
    const created = Object.values(store.spot).filter((spot) => spot.title_name === "新しい作品");
    // 空欄の行も、同じ作品で入れた URL を引き継ぐ
    expect(created.map((spot) => spot.title_url)).toEqual(["https://example.com/new", "https://example.com/new"]);
});
