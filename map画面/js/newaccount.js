// ログイン画面に戻る
function goToLogin() {
    window.location.href = "login.html";
}

// 入力チェックをしてから登録確認画面へ進む
function goToConfirm() {
    const name = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const email = document.getElementById("email").value.trim();

    const nameError = name === "";
    const passwordError = !/^[A-Za-z0-9]{8,}$/.test(password);
    const emailError = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    setFieldError("username", nameError);
    setFieldError("password", passwordError);
    setFieldError("email", emailError);

    if (nameError || passwordError || emailError) {
        // 最初のエラー項目にカーソルを移す
        const firstError = document.querySelector(".form-group.has-error input");
        if (firstError) firstError.focus();
        return;
    }

    // 確認画面で表示するため一時的に保存（パスワードは文字数だけ）
    sessionStorage.setItem("newAccount", JSON.stringify({
        name: name,
        email: email,
        passwordLength: password.length
    }));

    window.location.href = "confirm.html";
}

// 確認画面から戻ってきたときは入力内容を復元する
(function restoreInput() {
    const saved = JSON.parse(sessionStorage.getItem("newAccount") || "null");
    if (!saved) return;
    document.getElementById("username").value = saved.name;
    document.getElementById("email").value = saved.email;
})();
