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
async function logout() {
    try {
        await window.seitiAuth.logout();
    } catch (error) {
        console.warn("ログアウトに失敗しました:", error);
    }
    window.location.replace("login.html");
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

// ==========================================
// プロフィール
// ・名前とメールアドレスはログイン中のアカウント（Firebase）から表示する
// ・アイコンは端末に保存して、次に開いた時も表示する
// ==========================================
const PROFILE_STORAGE_KEY = "seitiProfile";

function loadProfile() {
    try {
        return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY)) || null;
    } catch (e) {
        return null;
    }
}

function saveProfileToStorage(icon) {
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ icon: icon }));
    } catch (e) {
        // 保存できない環境（プライベートモード等）では画面の表示だけ変える
    }
}

(function showSavedProfile() {
    const profile = loadProfile();
    if (profile && profile.icon) {
        document.getElementById("current-icon").textContent = profile.icon;
    }

    // ログイン中のアカウントの名前とメールアドレス
    window.seitiAuth.ready.then(function (user) {
        if (!window.seitiAuth.isLoggedIn(user)) return;
        document.getElementById("current-name").textContent = user.displayName || "名前未設定";
        document.getElementById("current-email").textContent = user.email || "";
    });
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
    document.getElementById("edit-error").hidden = true;

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
async function saveProfile() {
    const newName = document.getElementById("edit-name-input").value.trim();

    // 名前が空っぽの場合はエラー
    if (newName === "") {
        setFieldError("edit-name-input", true);
        document.getElementById("edit-name-input").focus();
        return;
    }

    // 画面上の名前とアイコンを、新しいものに書き換える
    const button = document.getElementById("save-profile-btn");
    const errorBox = document.getElementById("edit-error");
    button.disabled = true;
    errorBox.hidden = true;

    try {
        // 名前はアカウント（Firebase）に保存する
        await window.seitiAuth.updateName(newName);
    } catch (error) {
        console.warn("名前の保存に失敗しました:", error);
        errorBox.textContent = window.seitiAuth.errorMessage(error);
        errorBox.hidden = false;
        button.disabled = false;
        return;
    }

    document.getElementById("current-name").innerText = newName;
    document.getElementById("current-icon").innerText = tempSelectedIcon;
    saveProfileToStorage(tempSelectedIcon);
    button.disabled = false;
    closeEditModal();
}
