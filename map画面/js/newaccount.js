// ログイン画面に戻る
function goToLogin() {
    window.location.href = "login.html";
}

// 入力チェックをしてから登録確認画面へ進む
function goToConfirm() {
    const nickname = document.getElementById("nickname").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const nicknameError = nickname === "" || nickname.length > 20;
    const emailError = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const passwordError = !/^[A-Za-z0-9]{8,}$/.test(password);

    setFieldError("nickname", nicknameError);
    setFieldError("email", emailError);
    setFieldError("password", passwordError);

    if (nicknameError || emailError || passwordError) {
        // 最初のエラー項目にカーソルを移す
        const firstError = document.querySelector(".form-group.has-error input");
        if (firstError) firstError.focus();
        return;
    }

    // 確認画面で表示するため一時的に保存（パスワードは文字数だけ）
    sessionStorage.setItem("newAccount", JSON.stringify({
        nickname: nickname,
        email: email,
        passwordLength: password.length
    }));

    window.location.href = "confirm.html";
}

// 確認画面から戻ってきたときは入力内容を復元する
(function restoreInput() {
    const saved = JSON.parse(sessionStorage.getItem("newAccount") || "null");
    if (!saved) return;
    document.getElementById("nickname").value = saved.nickname || "";
    document.getElementById("email").value = saved.email;
})();
