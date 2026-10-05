// マイページに戻る（これは画面遷移）
function goToMyPage() {
    window.location.href = "mypage.html";
}

// 絞り込みメニューの 表示/非表示 を切り替える
function toggleFilter() {
    const filterMenu = document.getElementById("filter-menu");
    if (filterMenu.style.display === "none" || filterMenu.style.display === "") {
        filterMenu.style.display = "flex";
    } else {
        filterMenu.style.display = "none";
    }
}

// スタンプ詳細ポップアップを開く
function openStampModal(title, date, anime, scene, address) {
    document.getElementById("modal-title").innerText = title;
    document.getElementById("modal-date").innerText = "訪問日時：" + date;
    document.getElementById("modal-anime").innerText = anime;
    document.getElementById("modal-scene").innerText = scene;
    document.getElementById("modal-address").innerText = address;
    
    // モーダルを表示する
    document.getElementById("stamp-modal").style.display = "flex";
}

// スタンプ詳細ポップアップを閉じる
function closeStampModal() {
    document.getElementById("stamp-modal").style.display = "none";
}

// ==========================================
// データの取得
// ==========================================
const stamps = JSON.parse(localStorage.getItem("collectedStamps")) || [];
const stampList = document.getElementById("stampList");

// ==========================================
// スタンプを画面に表示する関数
// ==========================================
function renderStamps(filterAnimes = null) {
    if (!stampList) return; // エラー防止
    stampList.innerHTML = ""; 

    // 万が一ローカルストレージのデータがおかしい場合のエラー防止
    if (!stamps || !Array.isArray(stamps)) return;

    stamps.forEach(function(stamp) {
        // 【修正ポイント】 length（個数）ではなく、nullかどうかだけで判定します
        // filterAnimes が null ではなく、かつチェックされたアニメに含まれていない場合は非表示
        if (filterAnimes !== null && !filterAnimes.includes(stamp.anime)) {
            return; 
        }

        const div = document.createElement("div");
        div.className = "stamp-item";

        // クリックされたらポップアップを開く
        div.onclick = function() {
            openStampModal(stamp.name, stamp.date, stamp.anime, stamp.scene, stamp.address);
        };

        // 獲得済みのデザイン
        div.innerHTML = `
            <div class="stamp-circle earned">⛩️</div>
            <div class="stamp-label">${stamp.name}</div>
        `;

        stampList.appendChild(div);
    });
}

// ==========================================
// 絞り込みメニューを作る関数
// ==========================================
function initFilterMenu() {
    const filterMenu = document.getElementById("filter-menu");
    filterMenu.innerHTML = ""; // 中身を初期化

    // 獲得したスタンプの中から、作品名（アニメ名）の重複をなくしてリストアップする
    const animeNames = [...new Set(stamps.map(s => s.anime))];

    if (animeNames.length === 0) {
        filterMenu.innerHTML = "<p style='font-size:13px; color:#7f8c8d; text-align:center;'>獲得したスタンプがありません</p>";
        return;
    }

    // アニメ名ごとにチェックボックスを作る
    animeNames.forEach(function(anime) {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${anime}" class="anime-filter-cb"> ${anime}`;
        filterMenu.appendChild(label);
    });

    // 「決定」「リセット」ボタンのエリアを作る
    const btnDiv = document.createElement("div");
    btnDiv.style.display = "flex";
    btnDiv.style.gap = "10px";
    btnDiv.style.marginTop = "15px";

    // リセットボタン
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "リセット";
    resetBtn.style.flex = "1";
    resetBtn.style.padding = "10px";
    resetBtn.style.background = "#7f8c8d";
    resetBtn.style.color = "white";
    resetBtn.style.border = "none";
    resetBtn.style.borderRadius = "6px";
    resetBtn.onclick = function() {
        // チェックを全部外して、全件表示
        const checkboxes = document.querySelectorAll(".anime-filter-cb");
        checkboxes.forEach(cb => cb.checked = false);
        renderStamps(); 
        toggleFilter(); // メニューを閉じる
    };

    // 決定ボタン
    const applyBtn = document.createElement("button");
    applyBtn.textContent = "決定";
    applyBtn.style.flex = "1";
    applyBtn.style.padding = "10px";
    applyBtn.style.background = "#0b3c5d";
    applyBtn.style.color = "white";
    applyBtn.style.border = "none";
    applyBtn.style.borderRadius = "6px";
    applyBtn.onclick = function() {
        // チェックがついているアニメ名だけを集める
        const checkboxes = document.querySelectorAll(".anime-filter-cb:checked");
        const selectedAnimes = Array.from(checkboxes).map(cb => cb.value);
        
        // 選ばれたアニメだけを表示する
        renderStamps(selectedAnimes);
        toggleFilter(); // メニューを閉じる
    };

    btnDiv.appendChild(resetBtn);
    btnDiv.appendChild(applyBtn);
    filterMenu.appendChild(btnDiv);
}

// ==========================================
// 画面を開いた時の最初の処理
// ==========================================
renderStamps(); // スタンプを全て表示
initFilterMenu(); // 絞り込みメニューの準備