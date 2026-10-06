// ログイン画面に戻る
function goToLogin() {
    window.location.href = "login.html";
}

// パスワード再設定メールを送る
async function submitReissue() {
    const email = document.getElementById("email").value.trim();
    const button = document.getElementById("reset-btn");
    const errorBox = document.getElementById("reset-error");

    const emailError = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    setFieldError("email", emailError);
    errorBox.hidden = true;

    if (emailError) {
        document.getElementById("email").focus();
        return;
    }

    button.disabled = true;
    button.textContent = "送信中…";

    try {
        await window.seitiAuth.sendPasswordReset(email);
        document.getElementById("completion-modal").style.display = "flex";
    } catch (error) {
        // 未登録のメールアドレスかどうかは知らせない（他人の登録状況が分からないように）
        if (error && error.code === "auth/user-not-found") {
            document.getElementById("completion-modal").style.display = "flex";
        } else {
            console.warn("再設定メールの送信に失敗しました:", error);
            errorBox.textContent = window.seitiAuth.errorMessage(error);
            errorBox.hidden = false;
        }
    }

    button.disabled = false;
    button.textContent = "再設定メールを送る";
}

// ポップアップのボタンを押したときの処理
function closeModal() {
    document.getElementById("completion-modal").style.display = "none";
    // 閉じた後はログイン画面に戻す
    window.location.href = "login.html";
}
