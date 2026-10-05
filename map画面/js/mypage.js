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
    window.location.href = "login.html";
}

// 獲得スタンプ数を表示（スタンプ画面と同じデータを使う）
(function showStampCount() {
    let stamps = [];
    try {
        stamps = JSON.parse(localStorage.getItem("collectedStamps")) || [];
    } catch (e) {
        stamps = [];
    }
    document.getElementById("stamp-count").textContent = Array.isArray(stamps) ? stamps.length : 0;
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

    closeEditModal();
}
