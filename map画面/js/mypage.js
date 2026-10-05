
// マップ画面に戻る
function goToMap() {
    // マップのHTMLファイル名に合わせてください
    window.location.href = "map.html";
}

// 履歴画面へ
function goToHistory() {
    window.location.href = "history.html"
}

// スタンプ画面へ
function goToStamp() {
    window.location.href = "stamp.html";
}

// 新規聖地登録画面へ
function goToRegister() {
    alert("新規聖地登録画面へ遷移します（作成予定）");
}

// ログアウト処理
function logout() {
    // 確認のポップアップを出す
    const result = confirm("ログアウトしますか？");
    if (result) {
        // ログイン画面に戻る
        window.location.href = "login.html";
    }
}   
// ====== （ここから上は既存のコードを残してください） ====== //

// 選択中のアイコンを一時的に覚えておく変数
let tempSelectedIcon = "👤"; 

// 編集ポップアップを開く
function openEditModal() {
    // 現在設定されている名前を入力欄にセットする
    const currentName = document.getElementById("current-name").innerText;
    document.getElementById("edit-name-input").value = currentName;
    
    // ポップアップを表示
    document.getElementById("edit-modal").style.display = "flex";
}

// 編集ポップアップを閉じる
function closeEditModal() {
    document.getElementById("edit-modal").style.display = "none";
}

// アイコンを選択したときの処理
function selectIcon(element, icon) {
    // 選択されたアイコンを覚える
    tempSelectedIcon = icon;
    
    // すべてのアイコンから "selected" クラス（青枠）を消す
    const options = document.querySelectorAll(".icon-option");
    options.forEach(opt => {
        opt.classList.remove("selected");
    });
    
    // クリックされたアイコンにだけ "selected" クラス（青枠）をつける
    element.classList.add("selected");
}

// プロフィールを保存する処理
function saveProfile() {
    // 入力された名前を取得（前後の空白を消す）
    const newName = document.getElementById("edit-name-input").value.trim();
    
    // 名前が空っぽの場合はエラー
    if (newName === "") {
        alert("名前を入力してください。");
        return;
    }
    
    // 画面上の名前とアイコンを、新しいものに書き換える
    document.getElementById("current-name").innerText = newName;
    document.getElementById("current-icon").innerText = tempSelectedIcon;
    
    // ポップアップを閉じる
    closeEditModal();
}