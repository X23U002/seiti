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

const rowOf = (page, id) => page.locator("#spot-rows tr", { has: page.locator(".row-id", { hasText: new RegExp("^" + id + "$") }) });

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

    await page.fill("#filter-text", "宇治橋");
    const row = rowOf(page, bridge.id);
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
説明",34.9,135.81\r\n` +
        "zzz,作品,ない聖地,説明,,\r\n";
    await page.setInputFiles("#import-csv", { name: "spots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.locator("#toast")).toContainText("変更 1件・追加 1件");
    await expect(page.locator("#toast")).toContainText("見つからない ID：4行目（zzz）");
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
    expect(text.startsWith("﻿ID,作品名,スポット名,説明,緯度,経度")).toBe(true);
    expect(text).toContain(spotNamed("宇治橋").spot_name);
});
