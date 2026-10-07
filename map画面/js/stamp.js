// ==========================================
// スタンプ帳
// ・獲得したスタンプは collectedStamps（地図でスタンプを取った時に保存される）
// ・聖地の一覧は seitiSpotSummary（地図を開いた時に保存される）
//   一覧があれば、まだ集めていない聖地もグレーで並べる
// ==========================================

// マイページに戻る
function goToMyPage() {
    window.location.href = "mypage.html";
}

function readJson(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value === null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

// ---------- データの準備 ----------
let collected = readJson("collectedStamps", []);
if (!Array.isArray(collected)) collected = [];

// スポットID → 獲得したスタンプ
const collectedById = {};
collected.forEach(function (stamp) {
    if (!collectedById[String(stamp.id)]) {
        collectedById[String(stamp.id)] = stamp;
    }
});

const summary = readJson("seitiSpotSummary", null);
const hasSpotList = Boolean(summary && Array.isArray(summary.spots));

// 作品の色（地図のピンと同じ色。分からない時は紺）
function titleColor(title) {
    return (summary && summary.titles && summary.titles[title] && summary.titles[title].color) || "#0b3c5d";
}

// 表示するスタンプの一覧 { id, name, title, info, earned, date }
const allStamps = hasSpotList
    ? summary.spots.map(function (spot) {
        const stamp = collectedById[String(spot.id)];
        return {
            id: spot.id,
            name: spot.name,
            title: spot.title,
            info: (stamp && stamp.scene) || spot.info,
            earned: Boolean(stamp),
            date: stamp ? stamp.date : ""
        };
    })
    // 聖地の一覧がまだ無い時は、獲得したスタンプだけを並べる
    : Object.keys(collectedById).map(function (id) {
        const stamp = collectedById[id];
        return {
            id: stamp.id,
            name: stamp.name,
            title: stamp.anime,
            info: stamp.scene,
            earned: true,
            date: stamp.date
        };
    });

// 作品の並び（獲得が多い作品を先に）
const titles = [...new Set(allStamps.map(function (s) { return s.title; }))]
    .sort(function (a, b) {
        return earnedCount(b) - earnedCount(a) || countOf(b) - countOf(a);
    });

function countOf(title) {
    return allStamps.filter(function (s) { return s.title === title; }).length;
}

function earnedCount(title) {
    return allStamps.filter(function (s) { return s.title === title && s.earned; }).length;
}

// 表示の状態
let selectedTitle = null;   // null ＝ すべての作品

// ---------- 全体の進み具合 ----------
function renderOverall() {
    const got = allStamps.filter(function (s) { return s.earned; }).length;
    const total = hasSpotList ? allStamps.length : got;

    document.getElementById("got-count").textContent = got;
    document.getElementById("total-count").textContent = hasSpotList ? total : "?";

    const bar = document.getElementById("overall-bar");
    bar.setAttribute("aria-valuemax", String(total));
    bar.setAttribute("aria-valuenow", String(got));
    document.getElementById("overall-fill").style.width =
        (total > 0 ? got / total * 100 : 0) + "%";

    document.getElementById("rest-text").textContent = !hasSpotList
        ? "地図を一度開くと、まだ集めていない聖地も表示されます"
        : (got >= total && total > 0 ? "すべての聖地をコンプリート！" : "コンプリートまで あと " + (total - got) + " 個");
}

// ---------- 作品の札 ----------
function renderChips() {
    const area = document.getElementById("title-chips");
    area.innerHTML = "";

    function addChip(label, title, color, got, total) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "title-chip";
        chip.setAttribute("role", "tab");
        chip.setAttribute("aria-selected", String(selectedTitle === title));

        if (color) {
            const dot = document.createElement("span");
            dot.className = "color-dot";
            dot.style.background = color;
            chip.appendChild(dot);
        }

        chip.appendChild(document.createTextNode(label));

        if (total !== undefined) {
            const count = document.createElement("span");
            count.className = "chip-count";
            count.textContent = hasSpotList ? got + "/" + total : got;
            chip.appendChild(count);
        }

        chip.onclick = function () {
            selectedTitle = title;
            renderChips();
            renderSections();
        };
        area.appendChild(chip);
    }

    addChip("すべて", null, null);
    titles.forEach(function (title) {
        addChip(title, title, titleColor(title), earnedCount(title), countOf(title));
    });
}

// ---------- スタンプの一覧（作品ごと） ----------
function renderSections() {
    const area = document.getElementById("stamp-sections");
    const onlyEarned = document.getElementById("only-earned").checked;
    area.innerHTML = "";

    const shownTitles = selectedTitle === null ? titles : [selectedTitle];
    let shownCount = 0;

    shownTitles.forEach(function (title) {
        const items = allStamps.filter(function (s) {
            return s.title === title && (!onlyEarned || s.earned);
        });
        if (items.length === 0) return;
        shownCount += items.length;

        const section = document.createElement("section");
        section.className = "stamp-section card";

        const head = document.createElement("div");
        head.className = "section-head";

        const dot = document.createElement("span");
        dot.className = "color-dot";
        dot.style.background = titleColor(title);

        const name = document.createElement("h2");
        name.textContent = title;

        const count = document.createElement("span");
        count.className = "section-count";
        count.textContent = hasSpotList ? earnedCount(title) + " / " + countOf(title) : earnedCount(title) + " 個";

        head.append(dot, name, count);

        const grid = document.createElement("div");
        grid.className = "stamp-grid";

        // 獲得済みを先に並べる
        items
            .slice()
            .sort(function (a, b) { return Number(b.earned) - Number(a.earned); })
            .forEach(function (stamp) {
                grid.appendChild(createStampItem(stamp));
            });

        section.append(head, grid);
        area.appendChild(section);
    });

    if (shownCount === 0) {
        area.innerHTML = collected.length === 0
            ? '<div class="card empty-state"><div class="empty-state-icon">⛩️</div><p>まだスタンプがありません</p><small>地図で聖地を訪れて、スタンプを集めよう</small><a href="map.html" class="btn btn-primary">地図を開く</a></div>'
            : '<div class="card empty-state"><div class="empty-state-icon">🔍</div><p>表示できるスタンプがありません</p></div>';
    }
}

function createStampItem(stamp) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "stamp-item" + (stamp.earned ? "" : " is-locked");
    item.setAttribute("aria-label", stamp.name + (stamp.earned ? "（獲得済み）" : "（未獲得）"));

    const circle = document.createElement("div");
    circle.className = "stamp-circle";
    circle.setAttribute("aria-hidden", "true");

    if (stamp.earned) {
        circle.textContent = "⛩️";
        circle.style.background = titleColor(stamp.title);
    } else {
        circle.textContent = "?";
    }

    // 名前は textContent で入れる（HTMLとして解釈させない）
    const label = document.createElement("div");
    label.className = "stamp-label";
    label.textContent = stamp.name;

    item.append(circle, label);
    item.onclick = function () {
        openStampModal(stamp);
    };
    return item;
}

// ---------- 詳細ポップアップ ----------
function openStampModal(stamp) {
    const circle = document.getElementById("modal-circle");
    circle.textContent = stamp.earned ? "⛩️" : "?";
    circle.classList.toggle("is-locked", !stamp.earned);
    circle.style.background = stamp.earned ? titleColor(stamp.title) : "";

    document.getElementById("modal-title").textContent = stamp.name || "";

    const date = document.getElementById("modal-date");
    date.textContent = stamp.earned ? "訪問日：" + (stamp.date || "-") : "まだ獲得していません";
    date.classList.toggle("is-locked", !stamp.earned);

    document.getElementById("modal-anime").textContent = stamp.title || "-";
    document.getElementById("modal-scene").textContent = stamp.info || "-";

    // 地図でこの聖地を開く
    document.getElementById("modal-map-link").href =
        "map.html?spot=" + encodeURIComponent(stamp.id);

    document.getElementById("stamp-modal").style.display = "flex";
}

function closeStampModal() {
    document.getElementById("stamp-modal").style.display = "none";
}

// ---------- 画面を開いた時 ----------
document.getElementById("only-earned").addEventListener("change", renderSections);

renderOverall();
renderChips();
renderSections();
