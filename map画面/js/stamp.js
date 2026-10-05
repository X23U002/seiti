// マイページに戻る（これは画面遷移）
function goToMyPage() {
    window.location.href = "mypage.html";
}

// 絞り込みメニューの 表示/非表示 を切り替える
function toggleFilter() {
    const filterMenu = document.getElementById("filter-menu");
    const isOpen = filterMenu.style.display !== "none" && filterMenu.style.display !== "";
    filterMenu.style.display = isOpen ? "none" : "flex";
    document.getElementById("filter-toggle").setAttribute("aria-expanded", String(!isOpen));
}

// スタンプ詳細ポップアップを開く
function openStampModal(title, date, anime, scene, address) {
    document.getElementById("modal-title").innerText = title || "";
    document.getElementById("modal-date").innerText = "訪問日時：" + (date || "-");
    document.getElementById("modal-anime").innerText = anime || "-";
    document.getElementById("modal-scene").innerText = scene || "-";
    document.getElementById("modal-address").innerText = address || "-";

    document.getElementById("stamp-modal").style.display = "flex";
}

// スタンプ詳細ポップアップを閉じる
function closeStampModal() {
    document.getElementById("stamp-modal").style.display = "none";
}

// ==========================================
// データの取得
// ==========================================
let stamps = [];
try {
    stamps = JSON.parse(localStorage.getItem("collectedStamps")) || [];
} catch (e) {
    stamps = [];
}
if (!Array.isArray(stamps)) stamps = [];

const stampList = document.getElementById("stampList");

// ==========================================
// スタンプを画面に表示する関数
// filterAnimes が null のときは全件表示
// ==========================================
function renderStamps(filterAnimes = null) {
    if (!stampList) return;
    stampList.innerHTML = "";

    const visible = stamps.filter(function (stamp) {
        return filterAnimes === null || filterAnimes.includes(stamp.anime);
    });

    document.getElementById("stamp-count").textContent = visible.length;

    // 1件もない場合は案内を表示
    if (visible.length === 0) {
        stampList.innerHTML = stamps.length === 0
            ? '<div class="empty-state"><div class="empty-state-icon">⛩️</div><p>まだスタンプがありません</p><small>マップで聖地を訪れてスタンプを集めよう</small></div>'
            : '<div class="empty-state"><div class="empty-state-icon">🔍</div><p>該当するスタンプがありません</p></div>';
        return;
    }

    visible.forEach(function (stamp) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "stamp-item";
        item.onclick = function () {
            openStampModal(stamp.name, stamp.date, stamp.anime, stamp.scene, stamp.address);
        };

        const circle = document.createElement("div");
        circle.className = "stamp-circle earned";
        circle.setAttribute("aria-hidden", "true");
        circle.textContent = "⛩️";

        // 名前は textContent で入れる（HTMLとして解釈させない）
        const label = document.createElement("div");
        label.className = "stamp-label";
        label.textContent = stamp.name;

        item.appendChild(circle);
        item.appendChild(label);
        stampList.appendChild(item);
    });
}

// 絞り込み中の件数をボタンに表示
function updateFilterBadge(count) {
    const badge = document.getElementById("filter-active-count");
    badge.hidden = count === 0;
    badge.textContent = count;
}

// ==========================================
// 絞り込みメニューを作る関数
// ==========================================
function initFilterMenu() {
    const filterMenu = document.getElementById("filter-menu");
    filterMenu.innerHTML = "";

    // 獲得したスタンプの中から、作品名の重複をなくしてリストアップする
    const animeNames = [...new Set(stamps.map(s => s.anime))].filter(Boolean);

    if (animeNames.length === 0) {
        filterMenu.innerHTML = '<p class="filter-empty">獲得したスタンプがありません</p>';
        return;
    }

    // アニメ名ごとにチェックボックスを作る
    animeNames.forEach(function (anime) {
        const label = document.createElement("label");
        label.className = "filter-option";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = anime;
        checkbox.className = "anime-filter-cb";

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(anime));
        filterMenu.appendChild(label);
    });

    // 「決定」「リセット」ボタンのエリア
    const actions = document.createElement("div");
    actions.className = "filter-actions";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "btn btn-secondary";
    resetBtn.textContent = "リセット";
    resetBtn.onclick = function () {
        document.querySelectorAll(".anime-filter-cb").forEach(cb => cb.checked = false);
        renderStamps();
        updateFilterBadge(0);
        toggleFilter();
    };

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "btn btn-primary";
    applyBtn.textContent = "決定";
    applyBtn.onclick = function () {
        const checked = document.querySelectorAll(".anime-filter-cb:checked");
        const selectedAnimes = Array.from(checked).map(cb => cb.value);

        // 何もチェックしていない場合は全件表示
        renderStamps(selectedAnimes.length > 0 ? selectedAnimes : null);
        updateFilterBadge(selectedAnimes.length);
        toggleFilter();
    };

    actions.appendChild(resetBtn);
    actions.appendChild(applyBtn);
    filterMenu.appendChild(actions);
}

// ==========================================
// 画面を開いた時の最初の処理
// ==========================================
renderStamps();
initFilterMenu();
