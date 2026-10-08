// 新規登録入力画面に戻る
function goToRegister() {
    window.location.href = "newaccount.html";
}

// 登録完了処理
function goToComplete() {
    const saved = JSON.parse(sessionStorage.getItem("newAccount") || "null");

    // ニックネームをアプリ内の表示名として保存する（パスワードは保存しない）
    if (saved) {
        try {
            const profile = JSON.parse(localStorage.getItem("seitiProfile") || "null") || {};
            localStorage.setItem("seitiProfile", JSON.stringify({
                name: saved.nickname,
                icon: profile.icon || "👤"
            }));
            localStorage.setItem("seitiAccount", JSON.stringify({
                nickname: saved.nickname,
                email: saved.email
            }));
            // マイページの「ID」にはメールアドレスを表示する
            localStorage.setItem("seitiCurrentUserId", saved.email);
        } catch (e) {
            // 保存できない環境では何もしない
        }
    }

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
    document.getElementById("confirm-nickname").textContent = saved.nickname || "-";
    document.getElementById("confirm-email").textContent = saved.email;
    document.getElementById("confirm-password").textContent = "•".repeat(saved.passwordLength) + "（非表示）";
})();
