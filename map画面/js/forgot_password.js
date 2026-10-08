// ログイン画面に戻る
function goToLogin() {
    window.location.href = "login.html";
}

// パスワード再発行ボタンを押したときの処理
function submitReissue() {
    const email = document.getElementById("email").value.trim();

    const emailError = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    setFieldError("email", emailError);

    if (emailError) {
        document.getElementById("email").focus();
        return;
    }

    // 実際にはここでメール送信のプログラムを動かしますが、今回はポップアップを表示します
    document.getElementById("completion-modal").style.display = "flex";
}

// ポップアップのボタンを押したときの処理
function closeModal() {
    document.getElementById("completion-modal").style.display = "none";
    // 閉じた後はログイン画面に戻す
    window.location.href = "login.html";
}
