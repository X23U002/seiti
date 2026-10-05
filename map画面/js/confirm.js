// 新規登録入力画面に戻る
function goToRegister() {
    window.location.href = "newaccount.html";
}

// 登録完了処理
function goToComplete() {
    // 入力内容はもう不要なので消しておく
    sessionStorage.removeItem("newAccount");
    document.getElementById("complete-modal").style.display = "flex";
}

// マップ画面へ
function goToMap() {
    window.location.href = "map.html";
}

// 新規登録画面で入力した内容を表示する
(function showInput() {
    const saved = JSON.parse(sessionStorage.getItem("newAccount") || "null");
    if (!saved) return;
    document.getElementById("confirm-name").textContent = saved.name;
    document.getElementById("confirm-email").textContent = saved.email;
    document.getElementById("confirm-password").textContent = "•".repeat(saved.passwordLength) + "（非表示）";
})();
