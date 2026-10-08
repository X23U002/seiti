// マップ画面に戻る
function goToMap() {
    window.location.href = "map.html";
}

// 履歴画面へ
function goToHistory() {
    window.location.href = "history.html";
}

// スタンプ画面へ
function goToStamp() {
    window.location.href = "stamp.html";
}

// ログアウト確認ポップアップを開く／閉じる
function openLogoutModal() {
    document.getElementById("logout-modal").style.display = "flex";
}

function closeLogoutModal() {
    document.getElementById("logout-modal").style.display = "none";
}

// ログアウト処理
function logout() {
    try {
        localStorage.removeItem("seitiCurrentUserId");
    } catch (e) {
        // 保存できない環境では何もしない
    }
    window.location.href = "login.html";
}

// ==========================================
// 巡礼の記録（獲得スタンプ・作品ごとの達成度・最近のスタンプ）
// スタンプは stamp.html と同じ collectedStamps、
// 作品ごとの聖地の件数は地図画面が記録した seitiSpotSummary を使う
// ==========================================
function readJson(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value === null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

// 作品ごとの達成度で、最初に表示する作品の数
// （作品が増えてもマイページが縦に伸びすぎないように）
const PROGRESS_VISIBLE = 5;

// 「すべての作品を表示」ボタン
function setupProgressToggle(titleCount) {
    const button = document.getElementById("progress-more");
    const list = document.getElementById("progress-list");
    const hiddenCount = titleCount - PROGRESS_VISIBLE;

    if (hiddenCount <= 0) {
        button.hidden = true;
        return;
    }

    function update() {
        const expanded = list.classList.contains("is-expanded");
        button.textContent = expanded
            ? "閉じる"
            : "すべての作品を表示（あと " + hiddenCount + " 作品）";
        button.setAttribute("aria-expanded", String(expanded));
    }

    button.hidden = false;
    button.onclick = function () {
        list.classList.toggle("is-expanded");
        update();
    };
    update();
}

(function renderRecord() {
    let stamps = readJson("collectedStamps", []);
    if (!Array.isArray(stamps)) stamps = [];

    const summary = readJson("seitiSpotSummary", null);

    // 同じスポットのスタンプは1つと数える
    const uniqueStamps = [];
    const seen = new Set();
    stamps.forEach(function (stamp) {
        if (!seen.has(String(stamp.id))) {
            seen.add(String(stamp.id));
            uniqueStamps.push(stamp);
        }
    });

    // --- 集計 ---
    const animeNames = new Set(uniqueStamps.map(function (s) { return s.anime; }));
    document.getElementById("stamp-count").textContent = uniqueStamps.length;
    document.getElementById("anime-count").textContent = animeNames.size;

    if (summary && summary.total > 0) {
        document.getElementById("progress-rate").textContent =
            Math.round(uniqueStamps.length / summary.total * 100);
    }

    // --- 作品ごとの達成度 ---
    const progressList = document.getElementById("progress-list");
    progressList.innerHTML = "";

    if (!summary || !summary.titles) {
        progressList.innerHTML =
            '<li class="list-empty">地図を一度開くと、作品ごとの達成度が表示されます。</li>';
    } else {
        Object.keys(summary.titles)
            .map(function (title) {
                const got = uniqueStamps.filter(function (s) { return s.anime === title; }).length;
                const total = summary.titles[title].count;
                return {
                    title: title,
                    color: summary.titles[title].color,
                    got: Math.min(got, total),
                    total: total
                };
            })
            // 進んでいる作品を上に
            .sort(function (a, b) {
                return (b.got / b.total) - (a.got / a.total) || b.total - a.total;
            })
            .forEach(function (item, index) {
                const li = document.createElement("li");
                li.className = "progress-item";

                // 上位 PROGRESS_VISIBLE 作品より後ろは、最初は隠しておく
                if (index >= PROGRESS_VISIBLE) {
                    li.classList.add("is-extra");
                }

                const head = document.createElement("div");
                head.className = "progress-head";

                const dot = document.createElement("span");
                dot.className = "color-dot";
                dot.style.background = item.color;

                const name = document.createElement("span");
                name.className = "progress-name";
                name.textContent = item.title;

                const count = document.createElement("span");
                count.className = "progress-count";
                count.textContent = item.got + " / " + item.total;

                head.append(dot, name, count);

                const bar = document.createElement("div");
                bar.className = "progress-bar";
                bar.setAttribute("role", "progressbar");
                bar.setAttribute("aria-label", item.title + "の達成度");
                bar.setAttribute("aria-valuemin", "0");
                bar.setAttribute("aria-valuemax", String(item.total));
                bar.setAttribute("aria-valuenow", String(item.got));

                const fill = document.createElement("span");
                fill.style.width = (item.got / item.total * 100) + "%";
                fill.style.background = item.color;
                bar.appendChild(fill);

                li.append(head, bar);
                progressList.appendChild(li);
            });

        setupProgressToggle(Object.keys(summary.titles).length);
    }

    // --- 最近獲得したスタンプ（新しい順に3件） ---
    const recentList = document.getElementById("recent-list");
    recentList.innerHTML = "";

    if (uniqueStamps.length === 0) {
        recentList.innerHTML =
            '<li class="list-empty">まだスタンプがありません。地図で聖地を訪れてスタンプを集めよう。</li>';
    } else {
        uniqueStamps.slice(-3).reverse().forEach(function (stamp) {
            const li = document.createElement("li");
            li.className = "recent-item";

            const badge = document.createElement("span");
            badge.className = "recent-badge";
            badge.setAttribute("aria-hidden", "true");
            badge.textContent = "⛩️";
            if (summary && summary.titles && summary.titles[stamp.anime]) {
                badge.style.background = summary.titles[stamp.anime].color;
            }

            const body = document.createElement("div");
            body.className = "recent-body";

            const name = document.createElement("strong");
            name.textContent = stamp.name || "無題のスポット";

            const meta = document.createElement("span");
            meta.textContent = (stamp.anime || "") + (stamp.date ? "・" + stamp.date : "");

            body.append(name, meta);
            li.append(badge, body);
            recentList.appendChild(li);
        });
    }
})();

// ログイン中のユーザーIDを表示
(function showUserId() {
    let userId = null;
    try {
        userId = localStorage.getItem("seitiCurrentUserId");
    } catch (e) {
        userId = null;
    }
    document.getElementById("current-user-id").textContent =
        "ID: " + (userId || "ゲスト");
})();

// ==========================================
// プロフィール（名前・アイコン）を端末に保存して、次に開いた時も表示する
// ==========================================
const PROFILE_STORAGE_KEY = "seitiProfile";

function loadProfile() {
    try {
        return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY)) || null;
    } catch (e) {
        return null;
    }
}

function saveProfileToStorage(name, icon) {
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ name: name, icon: icon }));
    } catch (e) {
        // 保存できない環境（プライベートモード等）では画面の表示だけ変える
    }
}

(function showSavedProfile() {
    const profile = loadProfile();
    if (!profile) return;
    if (profile.name) document.getElementById("current-name").textContent = profile.name;
    if (profile.icon) document.getElementById("current-icon").textContent = profile.icon;
})();

// 選択中のアイコンを一時的に覚えておく変数
let tempSelectedIcon = "👤";

// 編集ポップアップを開く
function openEditModal() {
    // 現在設定されている名前とアイコンを編集欄に反映する
    const currentName = document.getElementById("current-name").innerText;
    const currentIcon = document.getElementById("current-icon").innerText;
    document.getElementById("edit-name-input").value = currentName;
    setFieldError("edit-name-input", false);

    document.querySelectorAll(".icon-option").forEach(function (opt) {
        if (opt.textContent.trim() === currentIcon) {
            selectIcon(opt, currentIcon);
        }
    });

    document.getElementById("edit-modal").style.display = "flex";
    document.getElementById("edit-name-input").focus();
}

// 編集ポップアップを閉じる
function closeEditModal() {
    document.getElementById("edit-modal").style.display = "none";
}

// アイコンを選択したときの処理
function selectIcon(element, icon) {
    tempSelectedIcon = icon;

    // すべてのアイコンの選択を外してから、クリックされたものだけ選択状態にする
    document.querySelectorAll(".icon-option").forEach(function (opt) {
        opt.classList.remove("selected");
        opt.setAttribute("aria-checked", "false");
    });

    element.classList.add("selected");
    element.setAttribute("aria-checked", "true");
}

// プロフィールを保存する処理
function saveProfile() {
    const newName = document.getElementById("edit-name-input").value.trim();

    // 名前が空っぽの場合はエラー
    if (newName === "") {
        setFieldError("edit-name-input", true);
        document.getElementById("edit-name-input").focus();
        return;
    }

    // 画面上の名前とアイコンを、新しいものに書き換える
    document.getElementById("current-name").innerText = newName;
    document.getElementById("current-icon").innerText = tempSelectedIcon;
    saveProfileToStorage(newName, tempSelectedIcon);
    closeEditModal();
}
