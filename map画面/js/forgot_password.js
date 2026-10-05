// ログイン画面に戻る
function goToLogin() {
    window.location.href = "login.html";
}

// パスワード再発行ボタンを押したときの処理
function submitReissue() {
    // 実際にはここでメール送信のプログラムを動かしますが、今回はポップアップを表示します
    document.getElementById("completion-modal").style.display = "flex";
}

// ポップアップの「閉じる」ボタンを押したときの処理
function closeModal() {
    // ポップアップを隠す
    document.getElementById("completion-modal").style.display = "none";
    // 閉じた後はログイン画面に戻す
    window.location.href = "login.html";
}