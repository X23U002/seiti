// ==========================================
// 聖地の一括編集（管理者だけ）
// 作品名・スポット名・説明を表で直接書きかえ、まとめて保存する
// CSV で書き出し・読み込みもでき、ID が空の行は新しい聖地として足す（緯度・経度が必要）
// 誰が管理者かは Firestore のルールでも確かめている
// ==========================================
import {
    collection,
    doc,
    getDoc,
    getDocs,
    GeoPoint,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { db, getCurrentUser } from "./firebase-db.js?v=917161b9";
import { encodeGeohash } from "./geohash.js?v=fe42fce1";
import { assignSpotIds, buildCsv, readLatLng, readSpotCsv } from "./spot-csv.js?v=96226090";

// 表で直せる項目
const FIELDS = ["title_name", "spot_name", "spot_info"];
const FIELD_LABELS = { title_name: "作品名", spot_name: "スポット名", spot_info: "説明" };
const MAX_LENGTH = { title_name: 100, spot_name: 100, spot_info: 2000 };

// 表の1行：{ key, id, isNew, original: { 項目 }, value: { 項目 }, latitude, longitude, data: 保存してある全項目, error }
let rows = [];
let nextKey = 1;

function notify(message, type) {
    if (typeof window.showToast === "function") window.showToast(message, type);
}

function showNotice(icon, text, sub) {
    const notice = document.getElementById("table-notice");
    notice.innerHTML = "";
    const iconEl = document.createElement("div");
    iconEl.className = "empty-state-icon";
    iconEl.textContent = icon;
    const p = document.createElement("p");
    p.textContent = text;
    notice.append(iconEl, p);
    if (sub) {
        const small = document.createElement("small");
        small.textContent = sub;
        notice.appendChild(small);
    }
    notice.hidden = false;
    document.getElementById("table-main").hidden = true;
}

// ---------- 行の状態 ----------

function makeRow(id, data) {
    const original = {};
    FIELDS.forEach(function (field) { original[field] = String(data[field] || ""); });
    return {
        key: nextKey++,
        id: id,
        isNew: false,
        original: original,
        value: Object.assign({}, original),
        latitude: data.coord ? String(data.coord.latitude) : "",
        longitude: data.coord ? String(data.coord.longitude) : "",
        data: data,
        error: ""
    };
}

function makeNewRow(values) {
    const value = {};
    FIELDS.forEach(function (field) { value[field] = String(values[field] || ""); });
    return {
        key: nextKey++,
        id: "",
        isNew: true,
        original: { title_name: "", spot_name: "", spot_info: "" },
        value: value,
        latitude: String(values.latitude || ""),
        longitude: String(values.longitude || ""),
        data: null,
        error: ""
    };
}

function changedFields(row) {
    return FIELDS.filter(function (field) { return row.value[field] !== row.original[field]; });
}

function isDirty(row) {
    return row.isNew || changedFields(row).length > 0;
}

// 保存してよいか確かめる。だめならその理由
function validate(row) {
    for (const field of FIELDS) {
        const text = row.value[field].trim();
        if (!text) return FIELD_LABELS[field] + "が空です";
        if (Array.from(text).length > MAX_LENGTH[field]) {
            return FIELD_LABELS[field] + "は" + MAX_LENGTH[field] + "文字までです";
        }
    }
    if (row.isNew && !readLatLng(row.latitude, row.longitude)) {
        return "緯度・経度を数字で入れてください（日本の中の場所）";
    }
    return "";
}

// ---------- 表示 ----------

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function visibleRows() {
    const title = document.getElementById("filter-title").value;
    const text = document.getElementById("filter-text").value.trim().toLowerCase();
    return rows.filter(function (row) {
        // 新しい行と変えた行は、絞り込んでいても出す（見失わないように）
        if (isDirty(row)) return true;
        if (title && row.value.title_name !== title) return false;
        if (!text) return true;
        return [row.id, row.value.spot_name, row.value.spot_info].some(function (value) {
            return String(value).toLowerCase().includes(text);
        });
    });
}

function renderTitleFilter() {
    const select = document.getElementById("filter-title");
    const current = select.value;
    const counts = {};
    rows.forEach(function (row) {
        if (row.isNew) return;
        counts[row.original.title_name] = (counts[row.original.title_name] || 0) + 1;
    });
    select.innerHTML = "";
    const all = el("option", "", "すべての作品（" + rows.filter(function (row) { return !row.isNew; }).length + "）");
    all.value = "";
    select.appendChild(all);
    Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, "ja"); }).forEach(function (title) {
        const option = el("option", "", title + "（" + counts[title] + "）");
        option.value = title;
        select.appendChild(option);
    });
    select.value = counts[current] ? current : "";
}

function updateRowState(tr, row) {
    tr.classList.toggle("is-changed", !row.isNew && changedFields(row).length > 0);
    tr.classList.toggle("is-new", row.isNew);
    tr.classList.toggle("has-error", !!row.error);
    FIELDS.forEach(function (field) {
        const input = tr.querySelector('[data-field="' + field + '"]');
        if (input) input.classList.toggle("is-changed-cell", !row.isNew && row.value[field] !== row.original[field]);
    });
    const message = tr.querySelector(".row-error");
    message.textContent = row.error;
    message.hidden = !row.error;
    const undo = tr.querySelector(".row-undo");
    undo.hidden = !isDirty(row);
    undo.textContent = row.isNew ? "消す" : "戻す";
}

function renderRow(row) {
    const tr = el("tr");
    tr.dataset.key = String(row.key);

    const idCell = el("td", "col-id");
    idCell.appendChild(el("span", "row-id", row.isNew ? "（新規）" : row.id));
    idCell.appendChild(el("p", "row-error"));
    tr.appendChild(idCell);

    FIELDS.forEach(function (field) {
        const td = el("td", field === "spot_info" ? "col-info" : field === "title_name" ? "col-title" : "col-name");
        const input = field === "spot_info" ? el("textarea") : el("input");
        if (field === "spot_info") input.rows = 3;
        else input.type = "text";
        if (field === "title_name") input.setAttribute("list", "title-options");
        input.dataset.field = field;
        input.value = row.value[field];
        input.setAttribute("aria-label", (row.isNew ? "新しい聖地" : row.original.spot_name) + "の" + FIELD_LABELS[field]);
        input.addEventListener("input", function () {
            row.value[field] = input.value;
            row.error = "";
            updateRowState(tr, row);
            updateSaveButton();
        });
        td.appendChild(input);
        tr.appendChild(td);
    });

    const place = el("td", "col-place");
    if (row.isNew) {
        [["latitude", "緯度", "35.6812"], ["longitude", "経度", "139.7671"]].forEach(function (item) {
            const input = el("input");
            input.type = "text";
            input.inputMode = "decimal";
            input.placeholder = item[1] + "（例 " + item[2] + "）";
            input.dataset.field = item[0];
            input.value = row[item[0]];
            input.setAttribute("aria-label", "新しい聖地の" + item[1]);
            input.addEventListener("input", function () {
                row[item[0]] = input.value;
                row.error = "";
                updateRowState(tr, row);
            });
            place.appendChild(input);
        });
    } else {
        place.appendChild(el("span", "row-place", row.latitude && row.longitude
            ? Number(row.latitude).toFixed(5) + ", " + Number(row.longitude).toFixed(5)
            : "—"));
    }
    tr.appendChild(place);

    const action = el("td", "col-action");
    const undo = el("button", "btn-link row-undo");
    undo.type = "button";
    undo.addEventListener("click", function () {
        if (row.isNew) {
            rows = rows.filter(function (item) { return item !== row; });
        } else {
            row.value = Object.assign({}, row.original);
            row.error = "";
        }
        render();
    });
    action.appendChild(undo);
    tr.appendChild(action);

    updateRowState(tr, row);
    return tr;
}

function render() {
    const tbody = document.getElementById("spot-rows");
    tbody.innerHTML = "";
    const list = visibleRows();
    list.forEach(function (row) { tbody.appendChild(renderRow(row)); });
    if (list.length === 0) {
        const tr = el("tr");
        const td = el("td", "table-empty", "当てはまる聖地はありません");
        td.colSpan = 6;
        tr.appendChild(td);
        tbody.appendChild(tr);
    }
    document.getElementById("table-status").textContent =
        list.length + "件を表示中（全" + rows.filter(function (row) { return !row.isNew; }).length + "件）";
    updateSaveButton();
}

function updateSaveButton() {
    const dirty = rows.filter(isDirty).length;
    const button = document.getElementById("save-all");
    button.disabled = dirty === 0;
    button.textContent = dirty === 0 ? "変更はありません" : "保存する（" + dirty + "件）";
}

// 作品名の入力候補（今ある作品名）
function renderTitleOptions() {
    let list = document.getElementById("title-options");
    if (!list) {
        list = el("datalist");
        list.id = "title-options";
        document.body.appendChild(list);
    }
    list.innerHTML = "";
    [...new Set(rows.map(function (row) { return row.original.title_name; }).filter(Boolean))].sort().forEach(function (title) {
        const option = el("option");
        option.value = title;
        list.appendChild(option);
    });
}

// ---------- 行を足す・CSV ----------

document.getElementById("add-row").addEventListener("click", function () {
    rows.unshift(makeNewRow({ title_name: document.getElementById("filter-title").value }));
    render();
    const first = document.querySelector('#spot-rows tr.is-new [data-field="spot_name"]');
    if (first) first.focus();
});

document.getElementById("filter-title").addEventListener("change", render);
document.getElementById("filter-text").addEventListener("input", render);

document.getElementById("export-csv").addEventListener("click", function () {
    const list = rows.filter(function (row) { return !row.isNew; }).map(function (row) {
        return Object.assign({ id: row.id, latitude: row.latitude, longitude: row.longitude }, row.value);
    });
    const blob = new Blob([buildCsv(list)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const today = new Date();
    link.href = URL.createObjectURL(blob);
    link.download = "seiti-spots-" + today.getFullYear() +
        String(today.getMonth() + 1).padStart(2, "0") + String(today.getDate()).padStart(2, "0") + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    notify(list.length + "件を CSV に書き出しました");
});

// CSV を読み込んで、表に反映する（保存はしない）
document.getElementById("import-csv").addEventListener("change", async function (event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;

    let records;
    try {
        records = readSpotCsv(await file.text());
    } catch (error) {
        notify("CSV を読めませんでした：" + error.message, "error");
        return;
    }

    const byId = new Map(rows.filter(function (row) { return !row.isNew; }).map(function (row) { return [row.id, row]; }));
    let changed = 0;
    let added = 0;
    const unknown = [];

    records.forEach(function (record) {
        if (!record.id) {
            rows.unshift(makeNewRow(record));
            added++;
            return;
        }
        const row = byId.get(record.id);
        if (!row) {
            unknown.push(record.line + "行目（" + record.id + "）");
            return;
        }
        const before = changedFields(row).length;
        FIELDS.forEach(function (field) { if (record[field] !== "") row.value[field] = record[field]; });
        if (changedFields(row).length > 0 && before === 0) changed++;
    });

    render();
    const summary = "CSV を読み込みました：変更 " + changed + "件・追加 " + added + "件。確認して「保存する」を押してください";
    if (unknown.length > 0) {
        notify(summary + "。見つからない ID：" + unknown.slice(0, 5).join("、") + (unknown.length > 5 ? " ほか" : ""), "error");
    } else {
        notify(summary);
    }
});

// ---------- 保存 ----------

document.getElementById("save-all").addEventListener("click", async function () {
    const button = this;
    const dirty = rows.filter(isDirty);
    if (dirty.length === 0) return;

    let errors = 0;
    dirty.forEach(function (row) {
        row.error = validate(row);
        if (row.error) errors++;
    });
    if (errors > 0) {
        render();
        notify(errors + "件の行に直すところがあります（赤い行）", "error");
        return;
    }

    // 新しい聖地の ID を決め、作品の公式サイトは同じ作品の聖地から引き継ぐ
    const existing = rows.filter(function (row) { return !row.isNew; });
    const newRows = dirty.filter(function (row) { return row.isNew; });
    const ids = assignSpotIds(
        existing.map(function (row) { return { id: row.id, title_name: row.original.title_name }; }),
        newRows.map(function (row) { return row.value.title_name.trim(); })
    );
    const titleUrls = {};
    existing.forEach(function (row) {
        if (row.data && row.data.title_url && !titleUrls[row.original.title_name]) {
            titleUrls[row.original.title_name] = row.data.title_url;
        }
    });

    const writes = dirty.map(function (row) {
        const value = {};
        FIELDS.forEach(function (field) { value[field] = row.value[field].trim(); });
        if (!row.isNew) {
            const update = {};
            changedFields(row).forEach(function (field) { update[field] = value[field]; });
            return { row: row, id: row.id, update: update };
        }
        const place = readLatLng(row.latitude, row.longitude);
        const id = ids.shift();
        return {
            row: row,
            id: id,
            create: Object.assign(value, {
                coord: new GeoPoint(place.latitude, place.longitude),
                geo_hash: encodeGeohash(place.latitude, place.longitude, 8),
                image_url: "no_image",
                title_url: titleUrls[value.title_name] || ""
            })
        };
    });

    button.disabled = true;
    button.textContent = "保存中…";
    let saved = 0;
    try {
        // 1回にまとめて書けるのは500件まで
        for (let i = 0; i < writes.length; i += 400) {
            const part = writes.slice(i, i + 400);
            const batch = writeBatch(db);
            part.forEach(function (write) {
                if (write.create) batch.set(doc(db, "spot", write.id), write.create);
                else batch.update(doc(db, "spot", write.id), write.update);
            });
            await batch.commit();

            // 保存できた分を「保存済み」にする
            part.forEach(function (write) {
                const row = write.row;
                if (write.create) {
                    row.id = write.id;
                    row.isNew = false;
                    row.data = write.create;
                } else {
                    Object.assign(row.data, write.update);
                }
                FIELDS.forEach(function (field) { row.value[field] = row.value[field].trim(); });
                row.original = Object.assign({}, row.value);
            });
            saved += part.length;
        }
        notify(saved + "件の聖地を保存しました");
    } catch (error) {
        console.error(error);
        notify(
            (saved > 0 ? saved + "件は保存できましたが、残りを" : "") +
            (error && error.code === "permission-denied"
                ? "保存する権限がありません（管理者でログインしているか確認してください）"
                : "保存できませんでした。通信状況を確認してください"),
            "error"
        );
    }
    renderTitleFilter();
    renderTitleOptions();
    render();
});

// 保存していない変更があるまま閉じようとしたら確かめる
window.addEventListener("beforeunload", function (event) {
    if (rows.some(isDirty)) {
        event.preventDefault();
        event.returnValue = "";
    }
});

// ---------- 読み込み ----------

(async function start() {
    const user = await getCurrentUser();
    if (!user) {
        showNotice("🔑", "このページを使うにはログインが必要です");
        const link = el("a", "btn btn-primary", "ログインする");
        link.href = "login.html";
        document.getElementById("table-notice").appendChild(link);
        return;
    }

    try {
        const isAdmin = (await getDoc(doc(db, "admin", user.uid))).exists();
        if (!isAdmin) {
            showNotice("🚫", "このページは管理者だけが使えます");
            return;
        }
        const snapshot = await getDocs(collection(db, "spot"));
        snapshot.forEach(function (spotDoc) { rows.push(makeRow(spotDoc.id, spotDoc.data())); });
    } catch (error) {
        console.error(error);
        showNotice("⚠️", "読み込めませんでした", "通信状況を確認して、開き直してください");
        return;
    }

    rows.sort(function (a, b) { return a.id.localeCompare(b.id, "ja", { numeric: true }); });
    renderTitleFilter();
    renderTitleOptions();
    render();
    document.getElementById("table-notice").hidden = true;
    document.getElementById("table-main").hidden = false;
})();
