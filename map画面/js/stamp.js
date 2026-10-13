// ==========================================
// スタンプ帳
// ・獲得したスタンプはDB（user/{ユーザーID}/stamps）から stamp.html で読み込んで渡す
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
// 獲得したスタンプと読み込み状態（loading / ready / guest / error）
let collected = [];
let loadState = "loading";

// スポットID → 獲得したスタンプ
let collectedById = {};

const summary = readJson("seitiSpotSummary", null);
const hasSpotList = Boolean(summary && Array.isArray(summary.spots));

// 作品の色（地図のピンと同じ色。分からない時は紺）
function titleColor(title) {
    return (summary && summary.titles && summary.titles[title] && summary.titles[title].color) || "#0b3c5d";
}

// 表示するスタンプの一覧 { id, name, title, info, earned, date }
let allStamps = [];
let titles = [];

function buildStamps() {
    collectedById = {};
    collected.forEach(function (stamp) {
        if (!collectedById[String(stamp.id)]) {
            collectedById[String(stamp.id)] = stamp;
        }
    });

    allStamps = hasSpotList
        ? summary.spots.map(function (spot) {
            const stamp = collectedById[String(spot.id)];
            return {
                id: spot.id,
                name: spot.name,
                title: spot.title,
                info: (stamp && stamp.scene) || spot.info,
                earned: Boolean(stamp),
                date: stamp ? stamp.date : "",
                count: stamp ? stamp.count || 1 : 0
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
                date: stamp.date,
                count: stamp.count || 1
            };
        });

    // 作品の並び（獲得が多い作品を先に）
    titles = [...new Set(allStamps.map(function (s) { return s.title; }))]
        .sort(function (a, b) {
            return earnedCount(b) - earnedCount(a) || countOf(b) - countOf(a);
        });
}

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

// ---------- 作品の絞り込み ----------
// 選んでいる作品をボタンに表示する
function renderTitlePicker() {
    const dot = document.getElementById("picker-dot");
    const count = document.getElementById("picker-count");

    document.getElementById("picker-label").textContent =
        selectedTitle === null ? "すべての作品" : selectedTitle;

    dot.hidden = selectedTitle === null;
    if (selectedTitle !== null) {
        dot.style.background = titleColor(selectedTitle);
    }

    count.textContent = selectedTitle === null
        ? titles.length + "作品"
        : (hasSpotList ? earnedCount(selectedTitle) + "/" + countOf(selectedTitle) : earnedCount(selectedTitle) + "個");
}

// 全角・半角、大文字・小文字、カタカナ・ひらがなの違いを無視して探す
function normalizeText(text) {
    return String(text)
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\u30a1-\u30f6]/g, function (ch) {
            return String.fromCharCode(ch.charCodeAt(0) - 0x60);
        });
}

// 作品の一覧（検索欄の文字で絞る）
function renderTitleOptions() {
    const list = document.getElementById("title-options");
    const keyword = normalizeText(document.getElementById("title-search").value.trim());
    list.innerHTML = "";

    function addOption(label, title, color, got, total) {
        const li = document.createElement("li");
        const option = document.createElement("button");
        option.type = "button";
        option.className = "title-option";
        option.setAttribute("aria-pressed", String(selectedTitle === title));

        const dot = document.createElement("span");
        dot.className = "color-dot";
        if (color) {
            dot.style.background = color;
        } else {
            dot.classList.add("is-all");
        }

        const body = document.createElement("span");
        body.className = "option-body";

        const name = document.createElement("span");
        name.className = "option-name";
        name.textContent = label;

        const count = document.createElement("span");
        count.className = "option-count";
        count.textContent = hasSpotList ? got + " / " + total : got + "個";

        const bar = document.createElement("span");
        bar.className = "option-bar";
        const fill = document.createElement("span");
        fill.style.width = (total > 0 ? got / total * 100 : 0) + "%";
        if (color) fill.style.background = color;
        bar.appendChild(fill);

        body.append(name, count, bar);
        option.append(dot, body);

        option.onclick = function () {
            selectedTitle = title;
            closeTitlePicker();
            renderTitlePicker();
            renderSections();
        };

        li.appendChild(option);
        list.appendChild(li);
    }

    const earnedAll = allStamps.filter(function (s) { return s.earned; }).length;
    if (!keyword) {
        addOption("すべての作品", null, null, earnedAll, allStamps.length);
    }

    const matched = titles.filter(function (title) {
        return normalizeText(title).includes(keyword);
    });

    matched.forEach(function (title) {
        addOption(title, title, titleColor(title), earnedCount(title), countOf(title));
    });

    if (keyword && matched.length === 0) {
        const li = document.createElement("li");
        li.className = "option-empty";
        li.textContent = "「" + document.getElementById("title-search").value.trim() + "」に合う作品はありません";
        list.appendChild(li);
    }
}

function openTitlePicker() {
    const search = document.getElementById("title-search");
    search.value = "";
    renderTitleOptions();
    document.getElementById("title-modal").style.display = "flex";

    // スマホではキーボードが開いて一覧が隠れるので、マウス操作の時だけ検索欄にカーソルを置く
    if (window.matchMedia("(pointer: fine)").matches) {
        search.focus();
    } else {
        const current = document.querySelector('.title-option[aria-pressed="true"]');
        if (current) current.focus();
    }
}

function closeTitlePicker() {
    document.getElementById("title-modal").style.display = "none";
    document.getElementById("title-picker-btn").focus();
}

document.getElementById("title-search").addEventListener("input", renderTitleOptions);

// 検索欄でEnterを押したら、一番上の作品を選ぶ
document.getElementById("title-search").addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.isComposing) return;
    // そのままだと、閉じた後にフォーカスが戻ったボタンまでEnterで押されてしまう
    event.preventDefault();
    const first = document.querySelector("#title-options .title-option");
    if (first) first.click();
});

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

    // 読み込み中・未ログインなどの時は上のお知らせだけにする
    if (shownCount === 0 && loadState === "ready") {
        area.innerHTML = collected.length === 0
            ? '<div class="card empty-state"><div class="empty-state-icon">⛩️</div><p>まだスタンプがありません</p><small>地図で聖地を訪れて、スタンプを集めよう</small><a href="map.html" class="btn btn-primary">地図を開く</a></div>'
            : '<div class="card empty-state"><div class="empty-state-icon">🔍</div><p>表示できるスタンプがありません</p></div>';
    }
}

// 未ログイン・読み込み中・読み込み失敗の時は、一覧の上にお知らせを出す
function renderNotice() {
    const notice = document.getElementById("stamp-notice");
    const html = {
        loading: '<div class="card empty-state"><div class="empty-state-icon">⏳</div><p>スタンプを読み込み中…</p></div>',
        guest: '<div class="card empty-state"><div class="empty-state-icon">🔑</div><p>ログインするとスタンプを集められます</p><small>スタンプはアカウントに保存されます</small><a href="login.html" class="btn btn-primary">ログインする</a></div>',
        error: '<div class="card empty-state"><div class="empty-state-icon">⚠️</div><p>スタンプを読み込めませんでした</p><small>通信状況を確認して、開き直してください</small></div>'
    }[loadState];

    notice.innerHTML = html || "";
    notice.hidden = !html;
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
    date.textContent = !stamp.earned
        ? "まだ獲得していません"
        : (stamp.count > 1 ? "初めての訪問：" : "訪問日：") + (stamp.date || "-");
    date.classList.toggle("is-locked", !stamp.earned);

    // 獲得した回数（stamp コレクションの、このスポットの記録の数）
    const count = document.getElementById("modal-count");
    count.hidden = !stamp.earned;
    count.textContent = "獲得 " + stamp.count + "回";

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

// DBから読み込んだスタンプで表示し直す（stamp.html から呼ぶ）
function showStamps(stamps, state) {
    collected = Array.isArray(stamps) ? stamps : [];
    loadState = state;
    buildStamps();
    renderNotice();
    renderOverall();
    renderTitlePicker();
    renderSections();
}

// DBから読み込むまでは「読み込み中」と表示しておく
showStamps([], "loading");
