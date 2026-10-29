// ==========================================
// 聖地の一括編集：CSV の書き出し・読み込み・新しい聖地の ID
// （画面を持たない部分。テストしやすいように spot-table.js から分けている）
// ==========================================

// CSV の列（見出し → 項目）。英語の見出しでも読み込める
export const CSV_COLUMNS = [
    { key: "id", label: "ID" },
    { key: "title_name", label: "作品名" },
    { key: "spot_name", label: "スポット名" },
    { key: "spot_info", label: "説明" },
    { key: "latitude", label: "緯度" },
    { key: "longitude", label: "経度" }
];

function escapeCell(value) {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// rows：[{ id, title_name, spot_name, spot_info, latitude, longitude }]
// Excel で文字化けしないよう、先頭に BOM を付ける
export function buildCsv(rows) {
    const lines = [CSV_COLUMNS.map(function (column) { return column.label; }).join(",")];
    rows.forEach(function (row) {
        lines.push(CSV_COLUMNS.map(function (column) { return escapeCell(row[column.key]); }).join(","));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
}

// CSV の文字列 → 行の配列（"" で囲んだ中の , や改行にも対応）
export function parseCsvText(text) {
    const source = String(text || "").replace(/^﻿/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (quoted) {
            if (ch === '"' && source[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (ch === '"') {
                quoted = false;
            } else {
                cell += ch;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === ",") {
            row.push(cell);
            cell = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && source[i + 1] === "\n") i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += ch;
        }
    }
    if (cell !== "" || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    // 中身のない行は捨てる
    return rows.filter(function (cells) { return cells.some(function (value) { return value.trim() !== ""; }); });
}

// CSV の文字列 → [{ id, title_name, ... }]。見出しが分からなければ Error
export function readSpotCsv(text) {
    const table = parseCsvText(text);
    if (table.length === 0) throw new Error("CSV が空です");

    const header = table[0].map(function (value) { return value.trim(); });
    const indexOf = {};
    CSV_COLUMNS.forEach(function (column) {
        const index = header.findIndex(function (name) { return name === column.label || name === column.key; });
        if (index >= 0) indexOf[column.key] = index;
    });
    ["title_name", "spot_name", "spot_info"].forEach(function (key) {
        if (!(key in indexOf)) {
            const label = CSV_COLUMNS.find(function (column) { return column.key === key; }).label;
            throw new Error("1行目に「" + label + "」の列がありません");
        }
    });

    return table.slice(1).map(function (cells, i) {
        const record = { line: i + 2 };
        CSV_COLUMNS.forEach(function (column) {
            record[column.key] = column.key in indexOf ? String(cells[indexOf[column.key]] || "").trim() : "";
        });
        // 説明は中の改行を残し、前後の空白だけ取る
        if ("spot_info" in indexOf) record.spot_info = String(cells[indexOf.spot_info] || "").trim();
        return record;
    });
}

// 新しい聖地の ID を決める
// チームで使っている「s + 作品の番号2けた + その作品の中の番号2けた」（例：s0701）にそろえる
// existing：[{ id, title_name }]、titles：新しく足す聖地の作品名（足す順）
export function assignSpotIds(existing, titles) {
    const used = new Set(existing.map(function (spot) { return spot.id; }));
    const prefixOf = {};       // 作品名 → 作品の番号（"07" など）
    const lastNumber = {};     // 作品の番号 → その中で一番大きい番号
    let maxPrefix = 0;

    existing.forEach(function (spot) {
        const match = /^s(\d{2})(\d{2,})$/.exec(spot.id);
        if (!match) return;
        const prefix = match[1];
        maxPrefix = Math.max(maxPrefix, Number(prefix));
        if (!(spot.title_name in prefixOf)) prefixOf[spot.title_name] = prefix;
        lastNumber[prefix] = Math.max(lastNumber[prefix] || 0, Number(match[2]));
    });

    return titles.map(function (title) {
        if (!(title in prefixOf)) {
            maxPrefix += 1;
            prefixOf[title] = String(maxPrefix).padStart(2, "0");
        }
        const prefix = prefixOf[title];
        let id;
        do {
            lastNumber[prefix] = (lastNumber[prefix] || 0) + 1;
            id = "s" + prefix + String(lastNumber[prefix]).padStart(2, "0");
        } while (used.has(id));
        used.add(id);
        return id;
    });
}

// 新しい聖地の緯度・経度（日本の中か）を確かめる。正しければ { latitude, longitude }、だめなら null
export function readLatLng(latitudeText, longitudeText) {
    const latitude = Number(String(latitudeText).trim());
    const longitude = Number(String(longitudeText).trim());
    if (String(latitudeText).trim() === "" || String(longitudeText).trim() === "") return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < 20 || latitude > 46 || longitude < 122 || longitude > 154) return null;
    return { latitude: latitude, longitude: longitude };
}
